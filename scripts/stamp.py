#!/usr/bin/env python3
"""公開前に実行する。JS/CSS の URL に内容のハッシュを付けて、
ブラウザが古いキャッシュを使い続けないようにする。

    python3 scripts/stamp.py
"""
import hashlib
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
index = root / 'index.html'


def digest(path):
    return hashlib.md5(path.read_bytes()).hexdigest()[:8]


imports = {
    f'./{p.relative_to(root).as_posix()}': f'./{p.relative_to(root).as_posix()}?v={digest(p)}'
    for p in sorted((root / 'js').rglob('*.js'))
}
importmap = json.dumps({'imports': imports}, indent=2, ensure_ascii=False)

html = index.read_text()
html = re.sub(
    r'<script type="importmap">.*?</script>',
    lambda _: f'<script type="importmap">\n{importmap}\n  </script>',
    html, flags=re.S,
)
html = re.sub(r'css/style\.css(\?v=\w+)?', f'css/style.css?v={digest(root / "css/style.css")}', html)
index.write_text(html)
print(f'stamped {len(imports)} modules')
