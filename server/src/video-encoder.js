export const SUPPORTED_VIDEO_ENCODERS = ["h264_nvenc", "h264_vaapi", "libx264"];

const AUDIO_AND_CONTAINER_ARGS = [
  "-c:a", "aac",
  "-b:a", "128k",
  "-ac", "2",
  "-movflags", "frag_keyframe+empty_moov+default_base_moof",
  "-f", "mp4",
  "pipe:1",
];

/**
 * Build ffmpeg arguments for Featherplay's H.264 fragmented-MP4 output.
 *
 * VAAPI needs its DRM device configured before ffmpeg opens the input. The
 * other encoders need no extra input-side configuration.
 */
export function buildFfmpegArgs({ encoder, vaapiDevice }) {
  switch (encoder) {
    case "h264_nvenc":
      return [
        "-i", "pipe:0",
        "-c:v", "h264_nvenc",
        "-preset", "p4",
        "-profile:v", "high",
        "-level:v", "4.1",
        "-rc", "vbr",
        "-cq", "23",
        "-b:v", "0",
        ...AUDIO_AND_CONTAINER_ARGS,
      ];
    case "h264_vaapi":
      if (!vaapiDevice) {
        throw new Error(
          "VAAPI_DEVICE is required when VIDEO_ENCODER=h264_vaapi (for example /dev/dri/renderD128)",
        );
      }
      return [
        "-vaapi_device", vaapiDevice,
        "-i", "pipe:0",
        "-vf", "format=nv12,hwupload",
        "-c:v", "h264_vaapi",
        "-profile:v", "high",
        "-level:v", "4.1",
        "-qp", "23",
        ...AUDIO_AND_CONTAINER_ARGS,
      ];
    case "libx264":
      return [
        "-i", "pipe:0",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-profile:v", "high",
        "-level:v", "4.1",
        "-crf", "23",
        ...AUDIO_AND_CONTAINER_ARGS,
      ];
    default:
      throw new Error(
        `Unsupported VIDEO_ENCODER='${encoder}'. Expected one of: ${SUPPORTED_VIDEO_ENCODERS.join(", ")}`,
      );
  }
}
