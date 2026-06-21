import { Injectable } from '@nestjs/common';
import { writeFileSync } from 'fs';
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
  constructor(private readonly diffParser: PrDiffParser) {}

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
