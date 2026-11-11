"""Google Apps Script 用の画面ファイルを作る。

使い方:  python tools/build_gas.py
出力:    gas/index.html（Apps Script の「index」）… 画面の枠と style.css
         gas/appjs.html（Apps Script の「appjs」）… src/ の ES モジュールを1つにまとめた JavaScript

appjs は HTML として配信せず、index から google.script.run で受け取って実行する
（Apps Script の HTML 配信は JavaScript の `${...}` を壊すため）。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULES = ['logic', 'config', 'store', 'testdata', 'app']  # 依存される順

IMPORT_RE = re.compile(r"^import\s+(.+?)\s+from\s+'\./(\w+)\.js';\s*$", re.M)
EXPORT_RE = re.compile(r"^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)", re.M)


def bundle_module(name: str) -> str:
    code = (ROOT / 'src' / f'{name}.js').read_text(encoding='utf-8')
    prelude = []
    for spec, source in IMPORT_RE.findall(code):
        if source not in MODULES[:MODULES.index(name)]:
            raise SystemExit(f'{name}.js: 読み込み順の前にない {source}.js を参照しています')
        star = re.fullmatch(r'\*\s+as\s+(\w+)', spec)
        prelude.append(f'const {star.group(1)} = M_{source};' if star else f'const {spec} = M_{source};')
    code = IMPORT_RE.sub('', code)
    if re.search(r'^\s*(import|export)\s', code, re.M) and not EXPORT_RE.search(code):
        raise SystemExit(f'{name}.js: 変換できない import/export があります')
    exports = EXPORT_RE.findall(code)
    code = re.sub(r'^export\s+', '', code, flags=re.M)
    if re.search(r'^\s*export\s', code, re.M):
        raise SystemExit(f'{name}.js: 変換できない export があります')
    body = '\n'.join(prelude) + '\n' + code
    return f"// ---- {name}.js ----\nconst M_{name} = (() => {{\n{body}\nreturn {{ {', '.join(exports)} }};\n}})();\n"


def main() -> None:
    css = (ROOT / 'style.css').read_text(encoding='utf-8-sig')
    js = '\n'.join(bundle_module(m) for m in MODULES)
    for label, text in (('CSS', css), ('JS', js)):
        if '<?' in text or '?>' in text:
            raise SystemExit(f'{label} に Apps Script のテンプレート記号（<? ?>）が含まれています')
        if '</script' in text.lower() or '</style' in text.lower():
            raise SystemExit(f'{label} に </script> か </style> が含まれています')
    html = f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>チーム配車</title>
  <style>
{css}
  </style>
</head>
<body>
  <main id="app"><p class="muted">読み込み中…</p></main>
  <script>
    // 想定外のエラーを画面に出す（問い合わせのときに伝えてもらえるように）
    function showError(message) {{
      var app = document.getElementById('app');
      var p = document.createElement('p');
      p.className = 'error';
      p.textContent = 'エラーが発生しました：' + message;
      if (app) app.appendChild(p);
    }}
    window.addEventListener('error', function (e) {{ showError(e.message); }});
    window.APP_URL = /*APP_URL*/null;
    // プログラム本体（appjs）はテキストで受け取って実行する。
    // HTML として配信すると Apps Script が JavaScript の一部を壊すため。
    google.script.run
      .withSuccessHandler(function (code) {{
        var script = document.createElement('script');
        script.textContent = code;
        document.body.appendChild(script);
      }})
      .withFailureHandler(function (err) {{ showError(err && err.message ? err.message : String(err)); }})
      .getAppCode();
  </script>
</body>
</html>
"""
    out = ROOT / 'gas' / 'index.html'
    out.write_text(html, encoding='utf-8', newline='\n')
    print(f'wrote {out.relative_to(ROOT)} ({len(html):,} chars)')
    app = ROOT / 'gas' / 'appjs.html'
    # Apps Script の HTML ファイルとして保存できるよう、実行されない script 要素で包む
    app.write_text('<script type="text/plain">\n"use strict";\n' + js + '\n</script>\n', encoding='utf-8', newline='\n')
    print(f'wrote {app.relative_to(ROOT)} ({len(js):,} chars)')


if __name__ == '__main__':
    main()
