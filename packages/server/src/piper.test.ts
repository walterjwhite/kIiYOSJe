import { describe, it, expect } from "vitest";
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from "@mind/core";
import {
  PiperError,
  ensureVoice,
  parsePiperCommand,
  piperArgs,
  renderSpeech,
  voiceUrls,
  type PiperIo,
  type RunResult,
} from "./piper.js";

const DIR = "/voices";
const settings = (over: Partial<AudioSettings> = {}): AudioSettings => ({
  ...DEFAULT_AUDIO_SETTINGS,
  ...over,
});

/** An in-memory filesystem and a scriptable process, so nothing real is touched. */
function fakeIo(
  opts: {
    files?: string[];
    run?: (args: readonly string[], stdin: string) => RunResult | Error;
    failDownload?: boolean;
  } = {},
) {
  const files = new Set(opts.files ?? []);
  const log = {
    downloads: [] as string[],
    runs: [] as { file: string; args: readonly string[]; stdin: string }[],
  };
  const io: PiperIo = {
    exists: (p) => files.has(p),
    mkdirp: () => undefined,
    rename: (a, b) => {
      files.delete(a);
      files.add(b);
    },
    remove: (p) => void files.delete(p),
    download: async (url, dest) => {
      log.downloads.push(url);
      if (opts.failDownload) throw new Error("HTTP 500");
      files.add(dest);
    },
    run: async (file, args, stdin) => {
      log.runs.push({ file, args, stdin });
      const out = opts.run ? opts.run(args, stdin) : { code: 0, stderr: "" };
      if (out instanceof Error) throw out;
      // A successful Piper writes the file named after -f.
      if (out.code === 0) files.add(args[args.indexOf("-f") + 1]!);
      return out;
    },
  };
  return { io, files, log };
}

describe("parsePiperCommand", () => {
  it("splits a command into a program and its arguments", () => {
    expect(parsePiperCommand("python3 -m piper")).toEqual({
      file: "python3",
      args: ["-m", "piper"],
    });
    expect(parsePiperCommand("  piper ")).toEqual({ file: "piper", args: [] });
  });
  it("rejects an empty command", () => {
    expect(() => parsePiperCommand("   ")).toThrow(PiperError);
  });
});

describe("voiceUrls", () => {
  it("maps a voice name to its rhasspy/piper-voices path", () => {
    expect(voiceUrls("en_US-lessac-medium").onnx).toBe(
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx",
    );
    expect(voiceUrls("de_DE-thorsten_emotional-medium").config).toMatch(
      /de\/de_DE\/thorsten_emotional\/medium\/.*\.onnx\.json$/,
    );
  });
  it.each([
    "../../etc/passwd",
    "en_US-lessac",
    "en_US-lessac-medium/../x",
    "http://evil/x-y-low",
    "",
  ])("rejects %j so a name cannot become a path or host", (name) => {
    expect(() => voiceUrls(name)).toThrow(PiperError);
  });
});

describe("piperArgs", () => {
  it("turns speed into an inverse length scale and tone into prosody", () => {
    const args = piperArgs(settings({ speed: 2, tone: "calm" }), "/m.onnx", "/o.wav");
    // The command's own arguments (python3 -m piper) come first, then the model.
    expect(args.slice(0, 4)).toEqual(["-m", "piper", "-m", "/m.onnx"]);
    expect(args[args.indexOf("--length-scale") + 1]).toBe("0.500");
    expect(args[args.indexOf("--noise-scale") + 1]).toBe("0.5");
    expect(args[args.indexOf("--noise-w-scale") + 1]).toBe("0.6");
    expect(args).not.toContain("-s");
  });
  it("passes the speaker only when one is chosen", () => {
    const args = piperArgs(settings({ speaker: 3 }), "/m.onnx", "/o.wav");
    expect(args[args.indexOf("-s") + 1]).toBe("3");
  });
});

describe("ensureVoice", () => {
  it("does not touch the network when the voice is already on disk", async () => {
    const { io, log } = fakeIo({
      files: [`${DIR}/en_US-lessac-medium.onnx`, `${DIR}/en_US-lessac-medium.onnx.json`],
    });
    expect(await ensureVoice(settings(), DIR, io)).toBe(`${DIR}/en_US-lessac-medium.onnx`);
    expect(log.downloads).toEqual([]);
  });

  it("downloads both files when missing and leaves no partial files", async () => {
    const { io, files, log } = fakeIo();
    await ensureVoice(settings(), DIR, io);
    expect(log.downloads).toHaveLength(2);
    expect(files.has(`${DIR}/en_US-lessac-medium.onnx`)).toBe(true);
    expect([...files].some((f) => f.endsWith(".part"))).toBe(false);
  });

  it("refuses to download when automatic download is off", async () => {
    const { io, log } = fakeIo();
    await expect(ensureVoice(settings({ autoDownload: false }), DIR, io)).rejects.toMatchObject({
      code: "voice_missing",
    });
    expect(log.downloads).toEqual([]);
  });

  it("cleans up and reports a failed download", async () => {
    const { io, files } = fakeIo({ failDownload: true });
    await expect(ensureVoice(settings(), DIR, io)).rejects.toMatchObject({
      code: "download_failed",
    });
    expect(files.size).toBe(0);
  });
});

describe("renderSpeech", () => {
  const ready = [`${DIR}/en_US-lessac-medium.onnx`, `${DIR}/en_US-lessac-medium.onnx.json`];

  it("sends the text on stdin, never on the command line, and keeps the finished file", async () => {
    const { io, files, log } = fakeIo({ files: ready });
    await renderSpeech("Secret meeting at noon", settings(), DIR, "/out/day.wav", io);
    expect(log.runs[0]!.stdin).toBe("Secret meeting at noon");
    expect(log.runs[0]!.args.join(" ")).not.toContain("Secret");
    expect(files.has("/out/day.wav")).toBe(true);
    expect(files.has("/out/day.wav.part")).toBe(false);
  });

  it("reports a missing Piper with install guidance", async () => {
    const err = Object.assign(new Error("spawn piper ENOENT"), { code: "ENOENT" });
    const { io } = fakeIo({ files: ready, run: () => err });
    await expect(renderSpeech("hi", settings(), DIR, "/out/day.wav", io)).rejects.toMatchObject({
      code: "piper_not_found",
    });
  });

  it("reports a non-zero exit with the tail of stderr and keeps no output", async () => {
    const { io, files } = fakeIo({
      files: ready,
      run: () => ({ code: 2, stderr: "boom\nbad flag --length-scale" }),
    });
    await expect(renderSpeech("hi", settings(), DIR, "/out/day.wav", io)).rejects.toThrow(
      /code 2.*bad flag/,
    );
    expect(files.has("/out/day.wav")).toBe(false);
  });
});
