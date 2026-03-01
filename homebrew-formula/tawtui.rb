# typed: false
# frozen_string_literal: true

class Tawtui < Formula
  desc "Terminal UI for Taskwarrior, GitHub PRs, and Google Calendar"
  homepage "https://github.com/victorstein/tawtui"
  version "0.1.0"
  license "MIT"

  url "https://github.com/victorstein/tawtui/releases/download/v#{version}/tawtui-darwin-arm64"
  sha256 "PLACEHOLDER_SHA256"

  depends_on arch: :arm64
  depends_on :macos

  def install
    bin.install "tawtui-darwin-arm64" => "tawtui"
  end

  def caveats
    <<~EOS
      tawtui requires the following tools:

      Required:
        - Taskwarrior (task): brew install task
        - GitHub CLI (gh):    brew install gh
        - tmux:               brew install tmux

      Optional:
        - Google Calendar:    brew install steipete/tap/gogcli

      Run `tawtui` to launch the setup wizard.
    EOS
  end

  test do
    assert_match "tawtui", shell_output("#{bin}/tawtui --help 2>&1", 1)
  end
end
