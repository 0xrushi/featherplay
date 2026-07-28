import assert from "node:assert/strict";
import test from "node:test";

import { buildFfmpegArgs } from "../src/video-encoder.js";

test("builds the existing NVENC pipeline", () => {
  const args = buildFfmpegArgs({ encoder: "h264_nvenc" });

  assert.deepEqual(args.slice(0, 4), ["-i", "pipe:0", "-c:v", "h264_nvenc"]);
  assert.ok(args.includes("-cq"));
  assert.ok(args.includes("frag_keyframe+empty_moov+default_base_moof"));
});

test("builds VAAPI with its DRM device before the input", () => {
  const args = buildFfmpegArgs({
    encoder: "h264_vaapi",
    vaapiDevice: "/dev/dri/renderD129",
  });

  assert.deepEqual(args.slice(0, 6), [
    "-vaapi_device", "/dev/dri/renderD129",
    "-i", "pipe:0",
    "-vf", "format=nv12,hwupload",
  ]);
  assert.ok(args.includes("h264_vaapi"));
  assert.ok(args.includes("frag_keyframe+empty_moov+default_base_moof"));
});

test("requires a render node for VAAPI", () => {
  assert.throws(
    () => buildFfmpegArgs({ encoder: "h264_vaapi" }),
    /VAAPI_DEVICE is required/,
  );
});

test("supports software x264 fallback", () => {
  const args = buildFfmpegArgs({ encoder: "libx264" });

  assert.deepEqual(args.slice(0, 4), ["-i", "pipe:0", "-c:v", "libx264"]);
  assert.ok(args.includes("-crf"));
});

test("rejects unsupported encoders", () => {
  assert.throws(
    () => buildFfmpegArgs({ encoder: "definitely-not-an-encoder" }),
    /Unsupported VIDEO_ENCODER='definitely-not-an-encoder'/,
  );
});
