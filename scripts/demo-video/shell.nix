# NixOS tools for producing the demo video.
#
#   nix-shell scripts/demo-video/shell.nix
#
# ffmpeg does the assembly, masking, probing and muxing. Chromium renders the
# two cards. tesseract backs the PII check. piper-tts is the good voice and
# pulls a large closure (~1.8 GiB); espeak-ng is the rough fallback.
# xdotool/maim/xvfb/openbox drive the VS Code capture; android-tools gives adb.
# The Android emulator itself is not included — see README.md.
{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  packages = with pkgs; [
    ffmpeg
    chromium
    tesseract
    espeak-ng
    piper-tts
    xdotool
    maim
    xvfb
    openbox
    dejavu_fonts
    android-tools
  ];

  shellHook = ''
    echo "demo video tools:"
    echo "  ffmpeg   $(ffmpeg -version 2>/dev/null | head -n1 | cut -d' ' -f3)"
    echo "  chromium $(chromium --version 2>/dev/null)"
  '';
}
