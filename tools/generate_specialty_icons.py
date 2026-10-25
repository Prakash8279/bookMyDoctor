"""Draw small, original specialty illustrations shared by web and Flutter.

Run with the bundled Python runtime; requires Pillow only. The 4x canvas keeps
curves crisp after export to 128px PNGs.
"""

from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = (
    ROOT / "client/public/specialties",
    ROOT / "mobile/assets/specialties",
)
S = 4


def box(*coords):
    return tuple(round(value * S) for value in coords)


def line(draw, points, fill, width=3, joint="curve"):
    draw.line([(round(x * S), round(y * S)) for x, y in points], fill=fill,
              width=round(width * S), joint=joint)


def ellipse(draw, coords, fill, outline=None, width=1):
    draw.ellipse(box(*coords), fill=fill, outline=outline, width=round(width * S))


def polygon(draw, points, fill):
    draw.polygon([(round(x * S), round(y * S)) for x, y in points], fill=fill)


def heart(draw, color):
    ellipse(draw, (27, 35, 64, 73), color)
    ellipse(draw, (64, 35, 101, 73), color)
    polygon(draw, [(27, 55), (101, 55), (64, 103)], color)


def tooth(draw):
    white, edge = "#FFFDF9", "#7153A7"
    ellipse(draw, (35, 28, 92, 77), white, edge, 3)
    polygon(draw, [(37, 55), (45, 102), (56, 108), (64, 87),
                   (74, 107), (85, 102), (92, 55)], white)
    line(draw, [(37, 57), (45, 101), (56, 107), (64, 87),
                (74, 106), (85, 101), (91, 57)], edge, 3)
    line(draw, [(54, 50), (63, 54), (74, 49)], "#D8CFF1", 3)


def face(draw, hair="#6144A2", skin="#F1B197", child=False):
    ellipse(draw, (39, 32, 89, 94), skin)
    ellipse(draw, (47, 62, 53, 68), "#3A3254")
    ellipse(draw, (73, 62, 79, 68), "#3A3254")
    line(draw, [(58, 80), (65, 83), (72, 80)], "#B96A70", 2)
    ellipse(draw, (34, 21, 93, 61), hair)
    ellipse(draw, (40, 49, 88, 72), skin)
    ellipse(draw, (47, 62, 53, 68), "#3A3254")
    ellipse(draw, (73, 62, 79, 68), "#3A3254")
    if child:
        ellipse(draw, (41, 17, 68, 45), hair)
        ellipse(draw, (60, 12, 85, 39), hair)


def draw_symbol(kind, draw):
    plum, coral, blue, teal, gold = "#6446A5", "#E77E75", "#6689CD", "#4FAFA6", "#E7A64B"
    if kind == "general-physician":
        ellipse(draw, (44, 21, 84, 61), "#F0AF95")
        ellipse(draw, (44, 20, 84, 44), plum)
        polygon(draw, [(25, 113), (31, 73), (50, 62), (64, 87), (78, 62), (97, 73), (103, 113)], "#FFFDF9")
        line(draw, [(50, 62), (64, 88), (78, 62)], blue, 3)
        line(draw, [(40, 70), (42, 95), (58, 95)], plum, 4)
        ellipse(draw, (54, 91, 65, 102), gold)
        line(draw, [(89, 70), (86, 99)], plum, 4)
    elif kind == "cardiologist":
        heart(draw, coral)
        line(draw, [(31, 68), (49, 68), (55, 59), (63, 81),
                    (71, 61), (77, 68), (97, 68)], "#FFFDF9", 4)
    elif kind == "dermatologist":
        face(draw)
        ellipse(draw, (87, 76, 104, 93), coral)
        line(draw, [(95, 72), (95, 98)], "#FFFDF9", 2)
        line(draw, [(83, 85), (107, 85)], "#FFFDF9", 2)
    elif kind == "pediatrician":
        face(draw, hair="#6D56A9", child=True)
        ellipse(draw, (23, 74, 46, 97), gold)
        ellipse(draw, (29, 80, 40, 91), "#FFFDF9")
    elif kind == "gynecologist":
        face(draw, hair="#6144A2")
        polygon(draw, [(46, 93), (82, 93), (93, 113), (35, 113)], coral)
        line(draw, [(64, 93), (64, 109)], "#FFFDF9", 3)
        line(draw, [(57, 101), (71, 101)], "#FFFDF9", 3)
    elif kind in ("orthopedic-surgeon", "rheumatologist"):
        ellipse(draw, (27, 26, 52, 51), "#FFFDF9", plum, 3)
        ellipse(draw, (75, 77, 100, 102), "#FFFDF9", plum, 3)
        line(draw, [(43, 45), (84, 85)], "#FFFDF9", 20)
        line(draw, [(43, 45), (84, 85)], plum, 3)
        if kind == "rheumatologist":
            ellipse(draw, (55, 54, 72, 71), coral)
    elif kind in ("neurologist", "psychiatrist"):
        ellipse(draw, (31, 34, 96, 98), "#AF94D8")
        ellipse(draw, (30, 49, 57, 78), "#8A6CC2")
        ellipse(draw, (72, 30, 99, 68), "#8A6CC2")
        line(draw, [(63, 39), (63, 89)], "#FFFDF9", 3)
        line(draw, [(42, 61), (53, 68), (47, 84)], "#FFFDF9", 3)
        line(draw, [(83, 45), (75, 55), (83, 68)], "#FFFDF9", 3)
        if kind == "psychiatrist":
            heart(draw, coral)
            ellipse(draw, (38, 43, 90, 88), "#AF94D8")
            line(draw, [(62, 47), (62, 84)], "#FFFDF9", 3)
    elif kind == "ent-specialist":
        ellipse(draw, (38, 24, 93, 95), "#F3B79D")
        ellipse(draw, (52, 37, 82, 78), "#F5D0B7")
        line(draw, [(78, 50), (60, 47), (55, 60), (68, 69), (67, 88)], plum, 5)
        ellipse(draw, (63, 87, 76, 100), coral)
    elif kind == "ophthalmologist":
        ellipse(draw, (20, 43, 108, 84), "#FFFDF9")
        polygon(draw, [(20, 64), (44, 43), (84, 43), (108, 64),
                       (84, 84), (44, 84)], "#FFFDF9")
        line(draw, [(20, 64), (44, 43), (84, 43), (108, 64),
                    (84, 84), (44, 84), (20, 64)], plum, 4)
        ellipse(draw, (46, 45, 82, 82), blue)
        ellipse(draw, (56, 55, 72, 72), plum)
        ellipse(draw, (57, 55, 63, 61), "#FFFDF9")
    elif kind == "dentist":
        tooth(draw)
    elif kind == "gastroenterologist":
        line(draw, [(48, 30), (50, 57), (68, 63)], plum, 9)
        ellipse(draw, (49, 52, 93, 100), coral)
        ellipse(draw, (57, 57, 75, 74), "#F6C6B2")
        line(draw, [(89, 81), (93, 103)], plum, 5)
    elif kind == "pulmonologist":
        line(draw, [(64, 27), (64, 67), (44, 77)], plum, 6)
        line(draw, [(64, 67), (84, 77)], plum, 6)
        ellipse(draw, (28, 55, 61, 105), coral)
        ellipse(draw, (67, 55, 100, 105), blue)
        line(draw, [(64, 27), (64, 66)], "#FFFDF9", 2)
    elif kind in ("nephrologist", "urologist"):
        ellipse(draw, (27, 46, 61, 94), coral)
        ellipse(draw, (67, 46, 101, 94), blue)
        ellipse(draw, (49, 52, 69, 74), "#E7E4F5")
        line(draw, [(47, 80), (55, 106), (72, 106), (81, 80)], plum, 4)
    elif kind in ("endocrinologist", "diabetologist"):
        ellipse(draw, (44, 59, 84, 102), coral)
        polygon(draw, [(64, 20), (44, 69), (84, 69)], coral)
        ellipse(draw, (52, 67, 60, 75), "#FFFDF9")
        if kind == "diabetologist":
            line(draw, [(82, 34), (100, 34)], plum, 4)
            line(draw, [(91, 25), (91, 43)], plum, 4)
    elif kind == "oncologist":
        line(draw, [(43, 32), (84, 94)], coral, 15)
        line(draw, [(84, 32), (43, 94)], coral, 15)
        ellipse(draw, (44, 26, 83, 65), "#F6C4BC")
        ellipse(draw, (53, 35, 74, 56), "#E7E4F5")
    elif kind == "general-surgeon":
        polygon(draw, [(29, 80), (82, 30), (98, 47), (47, 97)], blue)
        polygon(draw, [(24, 85), (46, 96), (37, 105)], "#AEB9C7")
        line(draw, [(76, 38), (91, 53)], "#FFFDF9", 3)


COLORS = {
    "general-physician": "#E9E9FA", "cardiologist": "#FCE3E5",
    "dermatologist": "#EEE9FA", "pediatrician": "#E9E6FA",
    "gynecologist": "#FBE8EC", "orthopedic-surgeon": "#E7E9FA",
    "neurologist": "#E9E7F9", "psychiatrist": "#F6E6F2",
    "ent-specialist": "#E8E9F9", "ophthalmologist": "#E4EDF9",
    "dentist": "#E8F1F9", "gastroenterologist": "#FCEAE1",
    "pulmonologist": "#E6F1FA", "nephrologist": "#F9E9EA",
    "urologist": "#E5ECFA", "endocrinologist": "#FAEAE0",
    "diabetologist": "#FAEAE0", "oncologist": "#F8E5EE",
    "rheumatologist": "#E6EDFA", "general-surgeon": "#E8EFF8",
}


def main():
    for output in OUTPUTS:
        output.mkdir(parents=True, exist_ok=True)
    for name, background in COLORS.items():
        image = Image.new("RGBA", (128 * S, 128 * S))
        draw = ImageDraw.Draw(image)
        ellipse(draw, (4, 4, 124, 124), background)
        draw_symbol(name, draw)
        image = image.resize((128, 128), Image.Resampling.LANCZOS)
        for output in OUTPUTS:
            image.save(output / f"{name}.png", optimize=True)


if __name__ == "__main__":
    main()
