#!/usr/bin/env python3
"""Decode representative output frames and assemble a review sheet."""
import io, pathlib, subprocess
from PIL import Image, ImageDraw, ImageFont
ROOT=pathlib.Path(__file__).resolve().parents[1]
P=ROOT/'previews'
times=[0,12,24,28,32,36,40,44,52,56,68,89]
small=ImageFont.load_default(size=13)
title=ImageFont.load_default(size=26)
sheet=Image.new('RGB',(1640,902),'#20343d')
draw=ImageDraw.Draw(sheet)
draw.text((22,18),'PLANFAIT / LAC D’ANNECY',font=title,fill='#f2ead5')
draw.text((23,55),'90-second low-poly pilot study / fixed synthetic IGC / real DEM and shoreline',font=small,fill='#a9c0bd')
for i,t in enumerate(times):
    frame=subprocess.check_output(['ffmpeg','-v','error','-ss',str(t),'-i',str(ROOT/'output/planfait-fpv.webm'),'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'])
    image=Image.open(io.BytesIO(frame))
    image.save(P/f'video-{t:02d}.jpg',quality=93)
    image.thumbnail((400,225))
    x=10+(i%4)*410; y=92+(i//4)*263
    sheet.paste(image,(x,y))
    phase='THERMAL / RIGHT 22.5°/s' if 28<=t<60 else 'ENTRY / RIGHT' if 20<=t<28 else 'DEPARTURE / RIGHT' if 60<=t<68 else 'GLIDE'
    draw.text((x+4,y+232),f'{t//60:02d}:{t%60:02d}   {phase}',font=small,fill='#dfdfc8')
draw.text((23,878),'1280 × 720 / 24 fps / VP9 / 90.000 s / synthetic flight, not navigation data',font=small,fill='#a9c0bd')
sheet.save(P/'contact-sheet.jpg',quality=94)
print(P/'contact-sheet.jpg')
