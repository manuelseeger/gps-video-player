#!/usr/bin/env python3
"""Fetch/cache AWS Terrarium DEM; create an offline, metre-based local terrain grid."""
import concurrent.futures, hashlib, json, math, pathlib, urllib.request
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[1]
D=ROOT/'data'; T=D/'terrain'; T.mkdir(parents=True,exist_ok=True)
LAT,LON=45.842,6.245
S=111195; C=math.cos(math.radians(LAT)); Z=11; N=2**Z

def tile_xy(lat,lon):
    return ((lon+180)/360*N,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*N)
def loc(x,z): return LAT-z/S,LON+x/(S*C)
xs=list(range(-26000,-7500,300))+list(range(-7500,7500,125))+list(range(7500,26001,300))
zs=list(range(-24000,-7500,300))+list(range(-7500,7500,125))+list(range(7500,24001,300))
needed=set()
for z in zs:
    for x in xs:
        a,b=tile_xy(*loc(x,z)); needed.add((int(a),int(b)))
def fetch(tile):
    a,b=tile; p=T/f'{Z}-{a}-{b}.png'
    url=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{a}/{b}.png'
    if not p.exists():
        with urllib.request.urlopen(url,timeout=40) as r: p.write_bytes(r.read())
    return tile,Image.open(p).convert('RGB')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: images=dict(pool.map(fetch,sorted(needed)))
heights=[]
for z in zs:
    for x in xs:
        a,b=tile_xy(*loc(x,z)); rgb=images[int(a),int(b)].getpixel((min(255,int((a%1)*256)),min(255,int((b%1)*256))))
        heights.append(round(rgb[0]*256+rgb[1]+rgb[2]/256-32768,1))
(D/'dem.json').write_text(json.dumps(dict(origin=[LON,LAT],metresPerDegree=S,xs=xs,zs=zs,heights=heights),separators=(',',':')))
search=D/'lake-search.json'
if not search.exists():
    req=urllib.request.Request('https://nominatim.openstreetmap.org/search?q=Lac%20Annecy&format=json&polygon_geojson=1',headers={'User-Agent':'PlanfaitFPV/1.0 synthetic-film'})
    search.write_bytes(urllib.request.urlopen(req,timeout=30).read())
lake=json.loads(search.read_text())[0]
(D/'lake.geojson').write_text(json.dumps({'type':'Feature','properties':{'name':"Lac d’Annecy",'osm':'relation/2390533','attribution':'© OpenStreetMap contributors; ODbL 1.0'},'geometry':lake['geojson']},separators=(',',':')))
(D/'sources.json').write_text(json.dumps({'dem':{'zoom':Z,'url':'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png','tiles':[f'{Z}/{a}/{b}' for a,b in sorted(needed)],'attribution':'AWS / Mapzen Terrain Tiles. Produced using Copernicus data and information funded by the European Union — EU-DEM layers. See https://github.com/tilezen/joerd/blob/master/docs/attribution.md'},'lake':{'url':'https://nominatim.openstreetmap.org/search?q=Lac%20Annecy&format=json&polygon_geojson=1','osmRelation':2390533,'license':'ODbL 1.0; © OpenStreetMap contributors'},'trackSha256':hashlib.sha256((ROOT/'input/track.igc').read_bytes()).hexdigest()},indent=2))
print(f'{len(needed)} tiles; {len(xs)} x {len(zs)} grid; heights {min(heights)}..{max(heights)} m')
