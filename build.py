#!/usr/bin/env python3
"""
Bundles the project (index.html + css/style.css + js/net.js + js/main.js +
lib/three.min.js + lib/GLTFLoader.js) into a single self-contained
../card-drive.html file. The car/tree/grass models (assets/models/*.glb)
get base64-embedded as data: URIs too, since the single file has no
adjacent assets/ folder to fetch them from -- see *_MODEL_DATA_URI in
js/main.js.

Note: multiplayer needs a real WebSocket server, so this single-file build
only ever plays solo (js/net.js fails to connect and falls back gracefully).
For multiplayer, run `npm run server` and open the project folder instead.

Run from inside the card-drive/ folder:
    python3 build.py
"""
import base64
import pathlib

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent / "card-drive.html"

html = (HERE / "index.html").read_text(encoding="utf-8")
css = (HERE / "css" / "style.css").read_text(encoding="utf-8")
net_js = (HERE / "js" / "net.js").read_text(encoding="utf-8")
main_js = (HERE / "js" / "main.js").read_text(encoding="utf-8")
three = (HERE / "lib" / "three.min.js").read_text(encoding="utf-8")
gltf_loader = (HERE / "lib" / "GLTFLoader.js").read_text(encoding="utf-8")

MODELS = {
    "CAR_MODEL_DATA_URI": "hyper-gt.glb",
    "CAR2_MODEL_DATA_URI": "mister-beef.glb",
    "CAR3_MODEL_DATA_URI": "fast-charger.glb",
    "CAR4_MODEL_DATA_URI": "gt-supercar.glb",
    "TREE_MODEL_DATA_URI": "tree.glb",
    "GRASS_MODEL_DATA_URI": "grass.glb",
}
model_globals = ""
for global_name, filename in MODELS.items():
    data = (HERE / "assets" / "models" / filename).read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    model_globals += f'<script>window.{global_name} = "data:model/gltf-binary;base64,{b64}";</script>\n'

html = html.replace(
    '<link rel="stylesheet" href="css/style.css">',
    f"<style>\n{css}\n</style>",
)
html = html.replace(
    '<script src="lib/three.min.js"></script>',
    f"<script>{three}</script>",
)
html = html.replace(
    '<script src="lib/GLTFLoader.js"></script>',
    f"<script>{gltf_loader}</script>\n{model_globals}",
)
html = html.replace(
    '<script src="js/net.js"></script>\n<script src="js/main.js"></script>',
    f"<script>\n{net_js}\n</script>\n<script>\n{main_js}\n</script>",
)

OUT.write_text(html, encoding="utf-8")
print(f"Wrote {OUT} ({len(html):,} bytes)")
