#!/usr/bin/env python3
"""下載 pairs.txt 內的 Xenova/opus-mt-* 量化 ONNX 模型，整理成 manifest.json。用法：python build_models.py <輸出資料夾>"""
import os, sys, json
from huggingface_hub import hf_hub_download
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
here = os.path.dirname(os.path.abspath(__file__))
pairs = [l.strip() for l in open(os.path.join(here, 'pairs.txt'), encoding='utf-8') if l.strip() and not l.startswith('#')]
FILES = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json',
         'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']
LIMIT = 95 * 1024 * 1024
manifest = {'pairs': {}}
for pr in pairs:
    rid = 'Xenova/opus-mt-' + pr
    ok = True
    for f in FILES:
        try:
            p = hf_hub_download(rid, f, local_dir=os.path.join(out, rid))
            if os.path.getsize(p) > LIMIT:
                print('TOO BIG', rid, f, os.path.getsize(p)); ok = False; break
        except Exception as e:
            if f in ('special_tokens_map.json', 'generation_config.json'): continue
            print('SKIP', rid, f, type(e).__name__, str(e)[:100]); ok = False; break
    if not ok:
        import shutil; shutil.rmtree(os.path.join(out, rid), ignore_errors=True); continue
    prefix = ''
    try:                                    # 多目標語言模型（如 en-zh）需要 >>cmn_Hans<< 之類的開頭標記
        tj = json.load(open(os.path.join(out, rid, 'tokenizer.json'), encoding='utf-8'))
        vocab = tj.get('model', {}).get('vocab', {})
        names = list(vocab.keys()) if isinstance(vocab, dict) else [v[0] for v in vocab]
        for tok in ('>>cmn_Hans<<', '>>zho_Hans<<'):
            if tok in names: prefix = tok + ' '; break
    except Exception as e:
        print('prefix check failed', e)
    manifest['pairs'][pr] = {'id': rid, 'prefix': prefix}
    print('OK', rid, 'prefix=%r' % prefix)
json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w'), ensure_ascii=False, indent=1)
print(manifest)
