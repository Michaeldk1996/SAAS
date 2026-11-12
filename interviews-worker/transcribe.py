import sys
from faster_whisper import WhisperModel
wav, model = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'small.en')
m = WhisperModel(model, device='cpu', compute_type='int8')
segments, info = m.transcribe(wav, language='en', vad_filter=True)
print(' '.join(s.text.strip() for s in segments))
