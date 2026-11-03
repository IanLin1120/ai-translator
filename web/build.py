#!/usr/bin/env python3
"""組合手機版網頁：VER=1.0.0 python3 web/build.py  →  web/dist/index.html"""
import os, json, sys
here = os.path.dirname(os.path.abspath(__file__))
ver = os.environ.get('VER') or open(os.path.join(here, '..', 'VERSION')).read().strip()
R = lambda *p: open(os.path.join(here, *p), encoding='utf-8').read()
order = ['k_theme_lang', 'n_pure', 'n_core', 'k_helpers', 'k_xmlfmt', 'n_tabs', 'k_dropzone', 'n_image', 'k_excel', 'k_word', 'k_pdf', 'n_mail', 'n_screen', 'e_opus', 'e_engines', 'k_s2t', 'e_webcap', 'm_glue', 'm_web']
app = '\n'.join(R('parts', n + '.js') for n in order).replace('__VER__', ver)
def inline(src):            # 避免 </script> 提早結束標籤
    return src.replace('</script', '<\\/script')
vend = ''.join('<script>' + inline(R('vendor', n + '.js')) + '</script>\n' for n in ['jszip', 'xlsx', 'mammoth', 'pdf', 'opencc'])
worker = json.dumps(R('vendor', 'pdf.worker.js')).replace('</', '<\\/')
shell = R('shell.html')
assert shell.startswith('<body>')
html = ('<!DOCTYPE html>\n<html lang="zh-Hant">\n<head>\n<script>' + R('ota_boot.js').replace('__VER__', ver) + '</script>\n'
  '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">\n'
  '<meta name="theme-color" content="#efe5d3">\n<title>AI 全能翻譯</title>\n<style>' + R('mobile.css') + '</style>\n</head>\n' +
  shell + '\n' + vend +
  '<script>window.PDF_WORKER_URL = URL.createObjectURL(new Blob([' + worker + '], {type: "text/javascript"}));</script>\n'
  '<script>\n' + inline(app) + '\n</script>\n</body>\n</html>\n')
out = os.path.join(here, 'dist'); os.makedirs(out, exist_ok=True)
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(html)
print('built', os.path.join(out, 'index.html'), len(html), 'bytes, version', ver)
