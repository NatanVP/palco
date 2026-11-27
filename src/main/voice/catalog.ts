/**
 * Gerado a partir dos pacotes oficiais, com o hash conferido contra o publicado: whisper.cpp b5454 (mesmo commit da v1.9.5)
 * e os modelos de huggingface.co/ggerganov/whisper.cpp numa revisão fixa. Nada que não bata com estes hashes é executado.
 */
import type { ModelId } from '../../shared/voice'

export interface Pinned { url: string; sha256: string; size: number }
/** `files`: o que se extrai e se confere antes de cada execução; `links`: os atalhos de biblioteca que o palco recria. */
export interface RuntimeBuild extends Pinned { top: string; files: Record<string, string>; links: Record<string, string> }
export type { ModelId }
export interface VoiceModel extends Pinned { id: ModelId; file: string }

export const RUNTIME_TAG = 'b5454'

const x64: RuntimeBuild = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-ubuntu-x64.tar.gz',
  sha256: 'a72becf15d7917f990f6313867a52638b82b7f9ef237fb0c980dac56a135781c', size: 10364195, top: 'whisper-bin-ubuntu-x64',
  files: {
    'LICENSE': '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d',
    'libggml-base.so.0.26.0': '8cd57970d5ba71529442758c0b42cb820ed319e03be0691aead74ef298d3f51f',
    'libggml-cpu-alderlake.so': 'd33aa9c10d716534dff77655da446f09516ee4583b695e8cc1aa447e57848dac',
    'libggml-cpu-cannonlake.so': '0cb6e59a34c9798a512398e820942ee18ce99c1e0b308ec593e78655759eaafe',
    'libggml-cpu-cascadelake.so': 'a0286798b10092eabaf5f81ce9ae664aa78d3c609ed2138fa8a7ca22da73ef7d',
    'libggml-cpu-cooperlake.so': '4169f4b9c975e46ddc386b695f64fb3a38a3dacd40bbb15465a2a5dbcabb9a1f',
    'libggml-cpu-haswell.so': 'a63377026e388671d7925e729fced52d9dd85d1bca780dce97bc2c74817053d4',
    'libggml-cpu-icelake.so': '3f28f5a44dd3640cf179d4f678ea9bdacc536ad69b6b5fb5efd155b6b91c49c8',
    'libggml-cpu-ivybridge.so': '8b22efecdde26d41d3d864f2d5f6e29c31e0951d6453465d1f4fbda50b9eaa4b',
    'libggml-cpu-piledriver.so': 'e04b72d641d4ae129c05a2ca167dae4843eb0ecae5d40a31a5d98ae480641b11',
    'libggml-cpu-sandybridge.so': '806218b034614ad31dbe4fbae48bcc0282c966bbe9f0085380d1c49b6b0f7d0b',
    'libggml-cpu-sapphirerapids.so': 'd190abfe2ad900b24da89c883f633dc621f69ba12b2f5664659826374c1f4cfb',
    'libggml-cpu-skylakex.so': '66d8e2a22ef39225eb2d80e3a1dd9c8a7dd2be41966760c27f22e79623611dd5',
    'libggml-cpu-sse42.so': '58e6f62fa6bc2732c5a8b6323377ae62ba6cc1ebad9dfd298b6548819bd94375',
    'libggml-cpu-x64.so': 'c19a80e868a34bdb197e2901c8f785a77640d6e56055134514b5fa2807171af5',
    'libggml-cpu-zen4.so': '42bb25dff93816eb12327a1b82c04ae436dd17eebf30da556143ec9acffd9582',
    'libggml.so.0.26.0': '25406a47ddc7a6b45adb4995ad5efbc6a7ef6efbc43e64a506d978d11dd6fec8',
    'libwhisper.so.1.9.5': '1517f17d5188f7ef70cbb66a2b8ce258c510d20c25018d18e2801351de13cd55',
    'whisper-cli': '110a858e128d1fbc5a75899b42a1de8a7a4c10856bfe45dad1adc278f6459d14',
  },
  links: { 'libggml-base.so': 'libggml-base.so.0', 'libggml-base.so.0': 'libggml-base.so.0.26.0', 'libggml.so': 'libggml.so.0', 'libggml.so.0': 'libggml.so.0.26.0', 'libwhisper.so': 'libwhisper.so.1', 'libwhisper.so.1': 'libwhisper.so.1.9.5' }
}
const arm64: RuntimeBuild = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-ubuntu-arm64.tar.gz',
  sha256: '6b95ebfc60447df48e70ef00a73bdc3f41679ed2d01ef465827206a2ff325149', size: 4608377, top: 'whisper-bin-ubuntu-arm64',
  files: {
    'LICENSE': '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d',
    'libggml-base.so.0.26.0': '55ab0c640984646608f00f7cd382ff3780363b4aaaad7c6b65be059571a2eefd',
    'libggml-cpu.so': 'e8089bef17a3c3b4917c8693e22f672e0073356641c37fd15d8f9029a57b3276',
    'libggml.so.0.26.0': '2c8795ca216c624f2be8c2b4e8c5262f9ac138a5a99d912308460f9c63bedc61',
    'libwhisper.so.1.9.5': '1b126affbb535ec35c5fd83bbe17d465731a4b9d8ae00e2d3215ffd2a4f7e725',
    'whisper-cli': '83efce4e4e61c014045b2166422cb60a0a234764cad6a260fe8137fa562bd1db',
  },
  links: { 'libggml-base.so': 'libggml-base.so.0', 'libggml-base.so.0': 'libggml-base.so.0.26.0', 'libggml.so': 'libggml.so.0', 'libggml.so.0': 'libggml.so.0.26.0', 'libwhisper.so': 'libwhisper.so.1', 'libwhisper.so.1': 'libwhisper.so.1.9.5' }
}

/** Binários oficiais para Linux; outras plataformas não têm pacote fixado. */
export const RUNTIMES: Partial<Record<string, RuntimeBuild>> = { 'linux-x64': x64, 'linux-arm64': arm64 }

/** Modelos multilíngues (com português). O primeiro é o padrão. */
export const MODELS: readonly VoiceModel[] = [
  { id: 'base', file: 'ggml-base.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin', sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', size: 147951465 },
  { id: 'small-q5', file: 'ggml-small-q5_1.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin', sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', size: 190085487 },
  { id: 'small', file: 'ggml-small.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin', sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', size: 487601967 },
]
