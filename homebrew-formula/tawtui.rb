# typed: false
# frozen_string_literal: true

class Tawtui < Formula
  desc "Terminal UI for Taskwarrior, GitHub PRs, and Google Calendar"
  homepage "https://github.com/victorstein/tawtui"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/victorstein/tawtui/releases/download/v#{version}/tawtui-darwin-arm64"
      sha256 "PLACEHOLDER_ARM64_SHA256"
    else
      url "https://github.com/victorstein/tawtui/releases/download/v#{version}/tawtui-darwin-x64"
      sha256 "PLACEHOLDER_X64_SHA256"
    end
  end

  depends_on :macos

  def install
    binary_name = Hardware::CPU.arm? ? "tawtui-darwin-arm64" : "tawtui-darwin-x64"
    bin.install binary_name => "tawtui"
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
