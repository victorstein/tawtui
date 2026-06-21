import { Injectable } from '@nestjs/common';
import { writeFileSync } from 'fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { PrDiffParser } from './pr-diff-parser.service';
import type {
  DiffLineMap,
  ReviewFinding,
  ReviewOutput,
  AgentContext,
  AgentContextFile,
  FindingSeverity,
} from './hunk-review.types';

export class AgentReviewError extends Error {}

export interface StartReviewContext {
  diffRaw: string;
  lineMap: DiffLineMap;
  agentContextPath: string;
  authorLabel: string;
  prTitle: string;
}

interface RawModelFinding {
  file: string;
  line: number | null;
  severity?: string;
  summary: string;
  rationale?: string;
}

interface RawModelOutput {
  summary: string;
  findings: RawModelFinding[];
}

@Injectable()
export class AgentReviewService {
  private sessionId?: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly diffParser: PrDiffParser) {}

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  async startReview(ctx: StartReviewContext): Promise<ReviewOutput> {
    const prompt = this.buildReviewPrompt(ctx);
    const { sessionId, text } = await this.runTurn(prompt);
    this.sessionId = sessionId;
    return this.buildReviewOutput(
      text,
      ctx.lineMap,
      ctx.agentContextPath,
      ctx.authorLabel,
    );
  }

  async ask(message: string): Promise<string> {
    const turn = this.queue.then(() => this.runTurn(message));
    this.queue = turn.catch(() => undefined);
    const { sessionId, text } = await turn;
    this.sessionId = sessionId;
    return text;
  }

  dispose(): void {
    this.sessionId = undefined;
    this.queue = Promise.resolve();
  }

  private buildReviewPrompt(ctx: StartReviewContext): string {
    const anchorable = ctx.lineMap.files
      .filter((f) => !f.binary && f.newLines.size > 0)
      .map(
        (f) => `${f.path}: ${[...f.newLines].sort((a, b) => a - b).join(',')}`,
      )
      .join('\n');
    return [
      `Review the following GitHub pull request titled "${ctx.prTitle}".`,
      'Respond ONLY with JSON: {"summary": string, "findings": [{"file": string, "line": number|null, "severity": "info"|"warning"|"error", "summary": string, "rationale"?: string}]}.',
      'Anchor a finding on a line ONLY if that file+line appears in the anchorable map below; otherwise set "line": null.',
      'Anchorable lines (file: comma-separated new-file line numbers):',
      anchorable,
      'Unified diff:',
      ctx.diffRaw,
    ].join('\n\n');
  }

  protected async runTurn(
    prompt: string,
  ): Promise<{ sessionId: string; text: string }> {
    const options = this.sessionId ? { resume: this.sessionId } : {};
    const response = query({ prompt, options });
    let sessionId = this.sessionId ?? '';
    let text = '';
    for await (const message of response as AsyncIterable<SDKMessage>) {
      if (message.type === 'result' && message.subtype === 'success') {
        text = message.result;
        sessionId = message.session_id;
      } else if (message.type === 'system') {
        sessionId = message.session_id;
      }
    }
    return { sessionId, text };
  }

  buildReviewOutput(
    rawJson: string,
    map: DiffLineMap,
    agentContextPath: string,
    authorLabel: string,
  ): ReviewOutput {
    let parsed: RawModelOutput;
    try {
      parsed = JSON.parse(rawJson) as RawModelOutput;
    } catch {
      throw new AgentReviewError('Model output was not valid JSON');
    }
    if (
      !parsed ||
      typeof parsed.summary !== 'string' ||
      !Array.isArray(parsed.findings)
    ) {
      throw new AgentReviewError('Model output missing summary/findings');
    }

    const findings: ReviewFinding[] = parsed.findings.map((f) => ({
      file: f.file,
      line: f.line,
      severity: this.normalizeSeverity(f.severity),
      summary: f.summary,
      rationale: f.rationale,
    }));

    const { anchored, unanchored } = this.diffParser.validateAnchors(
      findings,
      map,
    );
    this.writeAgentContext(
      anchored,
      agentContextPath,
      authorLabel,
      parsed.summary,
    );

    return {
      anchoredFindings: anchored,
      agentContextPath,
      body: {
        summary: parsed.summary,
        unanchoredFindings: unanchored,
        unanchoredCount: unanchored.length,
      },
    };
  }

  private normalizeSeverity(value: string | undefined): FindingSeverity {
    return value === 'error' || value === 'warning' ? value : 'info';
  }

  private writeAgentContext(
    anchored: ReviewFinding[],
    path: string,
    authorLabel: string,
    summary: string,
  ): void {
    const byFile = new Map<string, AgentContextFile>();
    for (const f of anchored) {
      if (f.line === null) continue;
      let file = byFile.get(f.file);
      if (!file) {
        file = { path: f.file, annotations: [] };
        byFile.set(f.file, file);
      }
      file.annotations.push({
        newRange: [f.line, f.line],
        summary: f.summary,
        rationale: f.rationale,
        author: authorLabel,
      });
    }
    const ctx: AgentContext = {
      version: 1,
      summary,
      files: [...byFile.values()],
    };
    writeFileSync(path, JSON.stringify(ctx, null, 2), 'utf-8');
  }
}
