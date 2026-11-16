# Template for Gitguy268/homebrew-tap Formula/stem-player.rb. Fill in SHA256_SOURCE from the
# tag tarball after tagging.
class StemPlayer < Formula
  desc "Unofficial 3D browser replica of a four-stem music player, served on localhost"
  homepage "https://github.com/Gitguy268/stem-player"
  url "https://github.com/Gitguy268/stem-player/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "SHA256_SOURCE"
  license "MIT"
  head "https://github.com/Gitguy268/stem-player.git", branch: "main"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args(prefix: false)
    system "npm", "run", "build"
    libexec.install "dist", "scripts", "package.json", "LICENSE", "NOTICE"
    (bin/"stem-player").write <<~SH
      #!/bin/sh
      exec "#{formula_opt_bin("node")}/node" "#{libexec}/scripts/serve.mjs" "$@"
    SH
  end

  def caveats
    <<~EOS
      Run `stem-player --open`, or `stem-player` and open http://localhost:8791/
      The stem splitter downloads a Demucs model from Hugging Face the first time you use it.
      That model repository states no licence, so it is not covered by this formula's licence.
    EOS
  end

  test do
    port = free_port
    pid = spawn({ "PORT" => port.to_s }, bin/"stem-player")
    sleep 3
    assert_match "<html", shell_output("curl -s http://127.0.0.1:#{port}/")
  ensure
    Process.kill("TERM", pid) if pid
    Process.wait(pid) if pid
  end
end
