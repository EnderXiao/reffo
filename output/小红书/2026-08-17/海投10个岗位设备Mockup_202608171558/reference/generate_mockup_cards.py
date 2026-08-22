#!/usr/bin/env python3
"""Use xhs-writer's bundled image_generator.py to render the Reffo V2 cards."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


OUTPUT_DIR = Path(__file__).resolve().parent.parent
SKILL_DIR = Path("/Users/haishuanglong/.codex/skills/xhs-writer-skill")


def load_scoped_env(path: Path) -> None:
    """Load only the xhs-writer skill's own .env without printing values."""
    if not path.is_file():
        raise FileNotFoundError(f"Missing skill environment file: {path}")
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"").strip("'")
        if key:
            os.environ.setdefault(key, value)


load_scoped_env(SKILL_DIR / ".env")
sys.path.insert(0, str(SKILL_DIR / "scripts"))

from image_generator import GptImage2Generator  # noqa: E402


COMMON = """
Use case: ads-marketing, product UI device mockup.
Asset type: one Xiaohongshu image-post card, vertical 9:16.
Input image: the supplied Reffo product screenshot is the source of truth for the phone screen.

Visual system:
- Simple, casual Xiaohongshu style that feels made by a thoughtful job seeker, not a glossy brand campaign.
- Solid warm cream background #F6F1E7, no gradients, no sci-fi effects.
- Main text in bold, highly legible simplified Chinese; black ink #171717, coral-red emphasis #FF5C57, occasional cobalt-blue hand-drawn underline #2D6CDF.
- Generous negative space, slightly imperfect hand-drawn underline or arrow, one small expressive emoji at most.

Device mockup requirements:
- The screenshot must appear inside a realistic, generic modern smartphone shell, never as a raw floating rectangle.
- Graphite-black metal frame, slim even bezel, rounded corners, subtle pill-shaped front camera cutout, realistic glass reflection, soft natural tabletop shadow.
- No Apple logo, no phone brand, no watermark.
- Preserve the referenced Reffo interface hierarchy and recognizable content as faithfully as possible; do not redesign the product UI.
- Crop or obscure personal names and private resume data. Do not add ATS pass-rate, offer probability, hiring probability, or guaranteed-result claims.

Typography constraints:
- Render the requested large Chinese copy verbatim with no missing, duplicated, or substituted characters.
- Do not invent extra headline or promotional copy.
""".strip()


CARD_SPECS = {
    1: {
        "filename": "card_01_cover.png",
        "reference": "home.png",
        "prompt": COMMON
        + """

Composition:
- Large headline occupies the upper 42% with strong line breaks.
- A single large phone mockup rises from the lower edge at a slight 6-degree angle, showing the Reffo home screen.
- Add one small dizzy-face emoji near the headline and one casual blue underline under “一份简历”.

Text (verbatim, exactly two lines):
“海投10个岗位”
“还只用一份简历？”

Avoid: multiple phones, floating screenshot, dense labels, tiny unreadable headline, corporate poster polish.
""",
    },
    2: {
        "filename": "card_02_problem.png",
        "reference": "gap-analysis.png",
        "prompt": COMMON
        + """

Composition:
- Headline at top; supporting copy below it, left aligned.
- One upright phone mockup fills the lower half and shows the gap-analysis screen.
- Add a small hand-drawn arrow toward the phone screen; keep any score or probability-like number out of view.

Text (verbatim):
Headline: “问题可能不在你”
Body line 1: “有相关经历，只是没放到”
Body line 2: “JD 最想看的位置。”
Body line 3: “先看材料差距，再动手改。”

Avoid: raw screenshot, duplicated text, recruitment guarantees, ATS claims.
""",
    },
    3: {
        "filename": "card_03_versions.png",
        "reference": "job-versions.png",
        "prompt": COMMON
        + """

Composition:
- Headline and two-line body in the upper third.
- Three small graphite phone mockups are casually fanned across the lower two-thirds, each screen showing a different visible job-version area derived from the reference screenshot.
- Devices must remain readable and clearly separate; use subtle natural shadows.

Text (verbatim):
Headline: “一份源简历”
Body line 1: “每个目标岗位，单独留一个版本。”
Body line 2: “投得再多，也不会混成一团。”

Avoid: browser-window frames, laptop frames, raw rectangular screenshots, extra labels.
""",
    },
    4: {
        "filename": "card_04_workflow.png",
        "reference": "../intermediate/workflow-4up.png",
        "prompt": COMMON
        + """

The reference is a 2-by-2 source collage. Treat each quadrant as a separate Reffo screen source.

Composition:
- Headline at top.
- Four compact graphite smartphone mockups arranged in a clean 2-by-2 flow below, connected by a thin hand-drawn coral arrow.
- Phone 1 shows source-resume upload; phone 2 shows JD input; phone 3 shows material-gap analysis; phone 4 shows the editable generated resume.
- Put the step copy in one clear block above or between the phones, not inside the product UI.

Text (verbatim):
Headline: “流程其实很直”
Steps line 1: “① 放入源简历  ② 粘贴 JD”
Steps line 2: “③ 看材料差距  ④ 生成可编辑版本”

Avoid: one large raw collage, device overlap, illegible tiny labels, additional steps.
""",
    },
    5: {
        "filename": "card_05_boundary.png",
        "reference": "gap-analysis.png",
        "prompt": COMMON
        + """

Composition:
- Headline at top left with a large coral “≠” as the visual anchor.
- Body copy beneath it.
- One upright phone mockup in the lower half shows only qualitative material-gap categories; crop away any score, hiring probability, or pass-rate style content.

Text (verbatim):
Headline: “这点很重要”
Body line 1: “材料没写 ≠ 你不会”
Body line 2: “缺证据，先提醒你核实。”
Body line 3: “AI 初稿仍要自己核对。”

Avoid: checkmark guarantees, “100%”, ATS claims, raw screenshot, extra disclaimer text.
""",
    },
    6: {
        "filename": "card_06_interview.png",
        "reference": "interview-prep.png",
        "prompt": COMMON
        + """

Composition:
- Headline at top and a short two-line body below.
- One slightly angled phone mockup fills the lower half, displaying the interview-preparation screen.
- Add two tiny hand-drawn speech bubbles outside the phone containing only simple question-mark icons, not words.

Text (verbatim):
Headline: “改完简历，别急着投”
Body line 1: “把可能的问题、故事思路、反问方向一起过一遍。”
Body line 2: “面试前照着复盘。”

Avoid: raw screenshot, human portrait, fake testimonials, extra written copy.
""",
    },
    7: {
        "filename": "card_07_ending.png",
        "reference": "new-application.png",
        "prompt": COMMON
        + """

Composition:
- CTA headline at top, body below it.
- One centered graphite phone mockup in the lower half, showing the “new application” screen and visually suggesting a fresh job-specific version.
- Add one small hand-drawn coral arrow that loops from the CTA toward the phone.

Text (verbatim):
Headline: “投下一个岗位前”
Body line 1: “先给简历换个版本。”
Body line 2: “AI 生成内容要自己核对。”
Body line 3: “你最头疼的是哪一步？”

Avoid: QR code, website URL, raw screenshot, “立即购买”, guaranteed outcomes, extra copy.
""",
    },
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--card", type=int, choices=sorted(CARD_SPECS), required=True)
    args = parser.parse_args()

    spec = CARD_SPECS[args.card]
    generator = GptImage2Generator(aspect_ratio="9:16")
    reference_path = OUTPUT_DIR / "reference" / "sources" / spec["reference"]
    output_path = OUTPUT_DIR / "images" / spec["filename"]
    generator.generate_scene_image(
        scene_data={"index": args.card, "image_prompt": spec["prompt"]},
        output_path=str(output_path),
        size="auto",
        reference_image_path=str(reference_path.resolve()),
    )


if __name__ == "__main__":
    main()
