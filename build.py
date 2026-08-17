#!/usr/bin/env python3
"""
Bundles the project (index.html + css/style.css + js/net.js + js/main.js +
lib/three.min.js + lib/GLTFLoader.js) into a single self-contained
../card-drive.html file. The car model (assets/models/hyper-gt.glb) gets
base64-embedded as a data: URI too, since the single file has no adjacent
assets/ folder to fetch it from -- see CAR_MODEL_DATA_URI in js/main.js.

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

car_model_path = HERE / "assets" / "models" / "hyper-gt.glb"
car_model_b64 = base64.b64encode(car_model_path.read_bytes()).decode("ascii")
car_model_data_uri = f"data:model/gltf-binary;base64,{car_model_b64}"

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
    f"<script>{gltf_loader}</script>\n"
    f'<script>window.CAR_MODEL_DATA_URI = "{car_model_data_uri}";</script>',
)
html = html.replace(
    '<script src="js/net.js"></script>\n<script src="js/main.js"></script>',
    f"<script>\n{net_js}\n</script>\n<script>\n{main_js}\n</script>",
)

OUT.write_text(html, encoding="utf-8")
print(f"Wrote {OUT} ({len(html):,} bytes)")
