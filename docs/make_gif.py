"""Build docs/images/walkthrough.gif from the screenshots (a slideshow of real captures, not a screen recording).

    python docs/make_gif.py
"""
import os

from PIL import Image

IMAGES = os.path.join(os.path.dirname(__file__), "images")
FRAMES = [
    "01_login.png", "02_customers.png", "03_customer_360.png", "05_customer_barred.png", "06_command_palette.png",
    "07_recharge_details.png", "08_recharge_review.png", "09_recharge_receipt.png", "10_customer_dark.png",
    "12_copilot_answer.png", "13_copilot_browser_test.png",
]
WIDTH = 1000  # keeps the file small enough to embed in a README


def build() -> str:
    frames = []
    for name in FRAMES:
        image = Image.open(os.path.join(IMAGES, name)).convert("RGB")
        frames.append(image.resize((WIDTH, round(image.height * WIDTH / image.width)), Image.LANCZOS))
    frames = [f.quantize(colors=128, method=Image.Quantize.MEDIANCUT) for f in frames]
    path = os.path.join(IMAGES, "walkthrough.gif")
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=2200, loop=0, optimize=True)
    return path


if __name__ == "__main__":
    out = build()
    print(f"{out}: {os.path.getsize(out) / 1024 / 1024:.2f} MB, {len(FRAMES)} frames")
