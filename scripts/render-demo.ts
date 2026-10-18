import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';

// Optional recording post-processing only. No runtime state or model output is
// replaced: preserve every captured frame and add captions below the interface.
const source = process.argv[2];
if (!source) throw new Error('Usage: npm run demo:render -- path/to/video.webm [output-directory]');
const video = resolve(source);
const destination = resolve(process.argv[3] ?? '.local/demo-final');
const chapters = z.array(z.object({ seconds: z.number().nonnegative(), caption: z.string().min(1).max(180) }).strict()).min(1)
  .parse(JSON.parse(await readFile(resolve(dirname(video), 'chapters.json'), 'utf8')));
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', video], { encoding: 'utf8' });
if (probe.status !== 0) throw new Error('Install ffmpeg and ffprobe to render the recorded demo.');
const metadata = JSON.parse(probe.stdout);
const stream = metadata.streams.find((item: { width?: number }) => item.width);
const duration = Number(metadata.format.duration);
if (!stream || !Number.isFinite(duration) || duration <= 0) throw new Error('Recorded video has no usable duration or dimensions.');
if (chapters.some((chapter, index) => chapter.seconds >= duration || (index > 0 && chapter.seconds <= chapters[index - 1].seconds))) throw new Error('Chapter timestamps must be ordered and within the real recording.');
const timestamp = (seconds: number) => {
  const total = Math.floor(seconds * 100);
  return `${Math.floor(total / 360000)}:${String(Math.floor(total / 6000) % 60).padStart(2, '0')}:${String(Math.floor(total / 100) % 60).padStart(2, '0')}.${String(total % 100).padStart(2, '0')}`;
};
const escapeCaption = (caption: string) => caption.replaceAll('\\', '/').replaceAll('{', '(').replaceAll('}', ')').replaceAll('\n', ' ');
const captionHeight = 100;
const subtitles = `[Script Info]
ScriptType: v4.00+
PlayResX: ${stream.width}
PlayResY: ${stream.height + captionHeight}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,26,&H00FFFFFF,&H00FFFFFF,&H00251B19,&H00251B19,0,0,0,0,100,100,0,0,1,0,0,2,36,36,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${chapters.map((chapter, index) => `Dialogue: 0,${timestamp(chapter.seconds)},${timestamp(Math.min(chapters[index + 1]?.seconds ?? duration, chapter.seconds + 10))},Caption,,0,0,0,,${escapeCaption(chapter.caption)}`).join('\n')}
`;
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, 'captions.ass'), subtitles);
// Fixed local subtitle name avoids injecting file paths into ffmpeg's filter
// expression. All caller-supplied paths are separate process arguments.
const output = resolve(destination, 'athena-demo.mp4');
const rendered = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', video, '-vf', `pad=iw:ih+${captionHeight}:0:0:color=0x191b25,ass=captions.ass`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-y', output], { cwd: destination, stdio: 'inherit' });
if (rendered.status !== 0) throw new Error('Demo render failed; the original recording is unchanged.');
console.log(`Captioned working demonstration: ${output}`);
