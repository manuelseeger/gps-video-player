import * as THREE from '../vendor/three.module.js';
const [dem,lake,flight]=await Promise.all(['dem.json','lake.geojson','flight.json'].map(f=>fetch('../data/'+f).then(r=>r.json())));
const W=1280,H=720, D=Math.PI/180;
let seed=61429;
const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
const scene=new THREE.Scene();
scene.background=new THREE.Color('#b4cbd0');
scene.fog=new THREE.FogExp2('#b4cbd0',.000030);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance',logarithmicDepthBuffer:true});
renderer.setSize(W,H);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
document.body.prepend(renderer.domElement);
const camera=new THREE.PerspectiveCamera(61,W/H,.08,100000);
scene.add(camera);
scene.add(new THREE.HemisphereLight('#dbeaf1','#666d58',2.0));
const sun=new THREE.DirectionalLight('#ffe8bd',2.5);sun.position.set(-8000,10000,4000);scene.add(sun);
const coord=(lon,lat)=>[(lon-dem.origin[0])*dem.metresPerDegree*Math.cos(dem.origin[1]*D),(dem.origin[1]-lat)*dem.metresPerDegree];
const ring=lake.geometry.coordinates[0].map(([lon,lat])=>coord(lon,lat));
function inside(x,z) {
 let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];if(((a[1]>z)!==(b[1]>z))&&(x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]))c=!c;
 }return c;
}
function index(arr,x){let lo=0,hi=arr.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(arr[m]>x)hi=m;else lo=m;}return lo;}
function elevation(x,z){
 const i=index(dem.xs,x),j=index(dem.zs,z),w=dem.xs.length;
 const a=THREE.MathUtils.clamp((x-dem.xs[i])/(dem.xs[i+1]-dem.xs[i]),0,1),b=THREE.MathUtils.clamp((z-dem.zs[j])/(dem.zs[j+1]-dem.zs[j]),0,1);
 return THREE.MathUtils.lerp(THREE.MathUtils.lerp(dem.heights[j*w+i],dem.heights[j*w+i+1],a),THREE.MathUtils.lerp(dem.heights[(j+1)*w+i],dem.heights[(j+1)*w+i+1],a),b);
}
const terrainPos=[],terrainCol=[];
const forest=['#4d735d','#537960','#587d63','#5c8066','#608369'];
const meadow=['#929f72','#9ba778','#a2ac7c','#aab283'];
const stone=['#c5c3ab','#d0ccb3','#c9c7b0','#d7d1b8'];
const v=(i,j)=>[dem.xs[i],dem.heights[j*dem.xs.length+i],dem.zs[j]];
const ab=new THREE.Vector3(),ac=new THREE.Vector3(),normal=new THREE.Vector3();
function terrainTri(a,b,c){
 const x=(a[0]+b[0]+c[0])/3,z=(a[2]+b[2]+c[2])/3,y=(a[1]+b[1]+c[1])/3;
 if(inside(x,z))return;
 ab.fromArray(b).sub(new THREE.Vector3(...a));ac.fromArray(c).sub(new THREE.Vector3(...a));normal.crossVectors(ac,ab).normalize();
 const slope=Math.sqrt(normal.x**2+normal.z**2)/Math.abs(normal.y);
 const palette=(slope>.75&&y>1000)?stone:(y>1770||y<590)?meadow:forest;
 const broad=(Math.sin(x*.0011)+Math.cos(z*.0013)+2)/4;
 const color=new THREE.Color(palette[Math.min(palette.length-1,Math.floor(broad*palette.length))]);
 // Deliberately broad quiet facets, never image textures.
 color.multiplyScalar(.98+rand()*.04);
 for(const p of [a,c,b]){terrainPos.push(...p);terrainCol.push(color.r,color.g,color.b);}
}
for(let j=0;j<dem.zs.length-1;j++)for(let i=0;i<dem.xs.length-1;i++){
 const a=v(i,j),b=v(i+1,j),c=v(i+1,j+1),d=v(i,j+1);
 if((i+j)%2){terrainTri(a,b,d);terrainTri(b,c,d);}else{terrainTri(a,b,c);terrainTri(a,c,d);}
}
const tg=new THREE.BufferGeometry();tg.setAttribute('position',new THREE.Float32BufferAttribute(terrainPos,3));tg.setAttribute('color',new THREE.Float32BufferAttribute(terrainCol,3));tg.computeVertexNormals();
scene.add(new THREE.Mesh(tg,new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true,side:THREE.DoubleSide})));
// Exact OSM shoreline; simplification retains the distinctive two basins and Duingt bend.
const outline=[];let last=null;
for(let i=0;i<ring.length;i++){const p=ring[i];if(!last||Math.hypot(p[0]-last[0],p[1]-last[1])>45||i===ring.length-1){outline.push(p);last=p;}}
const shape=new THREE.Shape(outline.map(p=>new THREE.Vector2(p[0],-p[1])));
const waterG=new THREE.ShapeGeometry(shape);waterG.rotateX(-Math.PI/2);waterG.translate(0,449.5,0);
const water=new THREE.Mesh(waterG,new THREE.MeshBasicMaterial({color:'#397e89',side:THREE.DoubleSide}));scene.add(water);
// Sparse broad water facets inside the lake; no animated noise or phototextures.
const wp=[],wc=[];
for(let z=-11000;z<15000;z+=320)for(let x=-15000;x<2000;x+=320){
 const points=[[x,450,z],[x+320,450,z],[x+320,450,z+320],[x,450,z+320]];
 for(const ids of [[0,2,1],[0,3,2]]){
  const ps=ids.map(i=>points[i]);if(!ps.every(p=>inside(p[0],p[2])))continue;
  const col=new THREE.Color('#397e89').multiplyScalar(.98+rand()*.06);
  for(const p of ps){wp.push(...p);wc.push(col.r,col.g,col.b);}
 }
}
const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(wp,3));wg.setAttribute('color',new THREE.Float32BufferAttribute(wc,3));
scene.add(new THREE.Mesh(wg,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide})));
const shoreMat=new THREE.MeshBasicMaterial({color:'#8fbab0',side:THREE.DoubleSide});
const sp=[];for(let i=0;i<outline.length-1;i++){
 const a=outline[i],b=outline[i+1],dx=b[0]-a[0],dz=b[1]-a[1],n=Math.hypot(dx,dz),ox=-dz/n*10,oz=dx/n*10;
 sp.push(a[0]-ox,451,a[1]-oz,b[0]-ox,451,b[1]-oz,b[0]+ox,451,b[1]+oz,a[0]-ox,451,a[1]-oz,b[0]+ox,451,b[1]+oz,a[0]+ox,451,a[1]+oz);
}
const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));scene.add(new THREE.Mesh(sg,shoreMat));
// Small clustered forests, not a noisy carpet: all trees have simple flat cone crowns.
const treeG=new THREE.ConeGeometry(1,1,5,1);treeG.translate(0,.5,0);
const trees=new THREE.InstancedMesh(treeG,new THREE.MeshLambertMaterial({color:'#ffffff',flatShading:true}),4200);
const dummy=new THREE.Object3D();let ti=0;
for(let k=0;k<18000&&ti<4200;k++){
 const x=-11000+rand()*22000,z=-13000+rand()*24000,y=elevation(x,z);
 if(y<630||y>1660||inside(x,z)||Math.abs(elevation(x+50,z)-y)>35||Math.sin(x*.0013)+Math.cos(z*.0017)<-.2)continue;
 const h=16+rand()*18;dummy.position.set(x,y-1,z);dummy.scale.set(h*.32,h,h*.32);dummy.rotation.y=rand()*Math.PI;dummy.updateMatrix();trees.setMatrixAt(ti,dummy.matrix);trees.setColorAt(ti,new THREE.Color(['#466c55','#50735b','#597b60'][ti%3]));ti++;
}
trees.count=ti;scene.add(trees);
// Geographic village centres; stylized buildings are illustrative, not cadastral footprints.
const villages=[['Talloires',6.2145,45.8402,115,420],['Menthon',6.1953,45.8600,120,450],['Veyrier',6.1780,45.8814,90,420],['Annecy',6.1260,45.8990,300,1200],['Sévrier',6.1404,45.8630,130,600],['Saint-Jorioz',6.1640,45.8325,150,600],['Duingt',6.2055,45.8286,65,250],['Doussard',6.2200,45.7760,100,650],['Bluffy',6.2190,45.8700,55,300]];
const houses=[];
const boxG=new THREE.BoxGeometry(1,1,1),roofG=new THREE.ConeGeometry(1,1,4);roofG.rotateY(Math.PI/4);
const houseMat=new THREE.MeshLambertMaterial({color:'#e0d8bb',flatShading:true}),roofMat=new THREE.MeshLambertMaterial({color:'#ad7860',flatShading:true});
for(const [name,lon,lat,count,radius] of villages){
 const [cx,cz]=coord(lon,lat);
 for(let i=0;i<count;i++){
  const a=rand()*Math.PI*2,r=Math.sqrt(rand())*radius,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r,y=elevation(x,z);
  if(inside(x,z)||y<449||Math.abs(elevation(x+20,z)-y)>15)continue;
  houses.push([x,y,z,8+rand()*12,7+rand()*8,8+rand()*12,Math.floor(rand()*4)*Math.PI/2]);
 }
}
const hm=new THREE.InstancedMesh(boxG,houseMat,houses.length),rm=new THREE.InstancedMesh(roofG,roofMat,houses.length);
houses.forEach(([x,y,z,sx,sy,sz,a],i)=>{
 dummy.position.set(x,y+sy/2,z);dummy.rotation.set(0,a,0);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();hm.setMatrixAt(i,dummy.matrix);
 dummy.position.y=y+sy+2.5;dummy.scale.set(sx*.8,5,sz*.8);dummy.updateMatrix();rm.setMatrixAt(i,dummy.matrix);
});scene.add(hm,rm);
// Far haze closes the DEM edge with layered, deliberately simple Alpine silhouettes.
for(let layer=0;layer<2;layer++){
 const p=[];const radius=39000+layer*11000;
 for(let i=0;i<144;i++){
  const a=i/144*Math.PI*2,b=(i+1)/144*Math.PI*2;
  const height=t=>1700+layer*180+700*Math.sin(t*7+.4)+450*Math.cos(t*13)+200*Math.sin(t*29);
  p.push(Math.sin(a)*radius,-1200,Math.cos(a)*radius,Math.sin(b)*radius,-1200,Math.cos(b)*radius,Math.sin(b)*radius,height(b),Math.cos(b)*radius,Math.sin(a)*radius,-1200,Math.cos(a)*radius,Math.sin(b)*radius,height(b),Math.cos(b)*radius,Math.sin(a)*radius,height(a),Math.cos(a)*radius);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));scene.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:layer?'#afc4ca':'#94aeb9',side:THREE.DoubleSide})));
}
// Sky dome: broad bands are intentionally graphic, like a painted comic panel.
const skyG=new THREE.SphereGeometry(80000,32,16);const skyM=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color('#6eabbf')},bottom:{value:new THREE.Color('#e4d9b7')}},vertexShader:'varying vec3 v; void main(){v=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform vec3 top; uniform vec3 bottom; varying vec3 v; void main(){float h=clamp(normalize(v).y*1.9+0.12,0.0,1.0);gl_FragColor=vec4(mix(bottom,top,h),1.0); #include <tonemapping_fragment> #include <colorspace_fragment> }'});
// Shader includes must be on their own preprocessor lines.
skyM.fragmentShader=skyM.fragmentShader.replace(' #include','\n#include').replace(' #include','\n#include').replace(' }','\n}');
const sky=new THREE.Mesh(skyG,skyM);sky.renderOrder=-10;scene.add(sky);
// Pilot: boots, suspended legs, harness side panels, risers and fine suspension lines.
// These are camera-local but lightly counteract head glances, so this reads as a seated pilot.
const pilot=new THREE.Group();camera.add(pilot);
const mat=color=>new THREE.MeshLambertMaterial({color,flatShading:true});
const trouser=mat('#354555'),boot=mat('#29343b'),sole=mat('#c6c1a2'),harness=mat('#a35e48'),strap=mat('#343735'),metal=mat('#c4c5ad');
function mesh(geo,material,pos,scale,parent=pilot){const m=new THREE.Mesh(geo,material);m.position.set(...pos);if(scale)m.scale.set(...scale);parent.add(m);return m;}
function bar(a,b,r,material,parent=pilot){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),dir=bv.clone().sub(av);const g=new THREE.CylinderGeometry(r,r,dir.length(),5);const m=new THREE.Mesh(g,material);m.position.copy(av.add(bv).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());parent.add(m);return m;}
for(const s of [-1,1]){
 bar([s*.17,-.73,-.40],[s*.235,-.78,-1.48],.10,trouser);
 const b=mesh(new THREE.BoxGeometry(.21,.18,.43),boot,[s*.24,-.80,-1.68]);b.rotation.set(-.13,s*-.11,s*-.10);
 mesh(new THREE.BoxGeometry(.215,.025,.44),sole,[s*.24,-.90,-1.68]);
 mesh(new THREE.BoxGeometry(.15,.07,.10),strap,[s*.24,-.70,-1.59]);
 mesh(new THREE.BoxGeometry(.25,.32,.61),harness,[s*.36,-.85,-.37]);
 // Thin webbing and lines stay near the margins of the seated pilot view.
 bar([s*.55,-.55,-.62],[s*.70,.00,-.90],.012,strap);
 bar([s*.70,.00,-.90],[s*.73,.29,-.96],.011,strap);
 const c=mesh(new THREE.TorusGeometry(.025,.005,4,8),metal,[s*.70,.015,-.90]);c.rotation.y=.4;
 for(let j=0;j<4;j++)bar([s*(.73+j*.009),.29,-.96],[s*(.90+j*.20),2.7,-1.65-j*.22],.0013,j===0?mat('#b07651'):mat('#e2e1c9'));
 const loop=mesh(new THREE.TorusGeometry(.032,.0045,4,9),mat('#b57646'),[s*.66,-.10,-.91]);loop.scale.y=1.45;
}
const headEuler=new THREE.Euler(0,0,0,'YXZ');
function sample(t){const i=Math.min(89,Math.floor(t)),u=t-i,a=flight[i],b=flight[i+1];return Object.fromEntries(['lat','lon','alt','airHeading','airSpeed'].map(k=>[k,THREE.MathUtils.lerp(a[k],b[k],u)]));}
const ease=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
function roll(t){
 let rate=0;for(const [at,delta] of [[20,45/8],[28,22.5-45/8],[60,5-22.5],[68,-5]])rate+=delta*ease((t-at+.55)/1.1);
 const speed=sample(t).airSpeed;return Math.atan(speed*rate*D/9.81);
}
window.renderFrame=(time)=>{
 const t=Math.max(0,Math.min(90,time)),f=sample(t),[x,z]=coord(f.lon,f.lat);
 const glance=(1.5*Math.sin(t*.28)+1.0*Math.sin(t*.63)+.5*Math.sin(t*.11))*D;
 const pitch=(-12+1.2*Math.sin(t*.23)+.35*Math.sin(t*1.1))*D;
 const bank=roll(t)+.65*D*Math.sin(t*.75);
 camera.position.set(x,f.alt,z);
 headEuler.set(pitch,-f.airHeading*D-glance,-bank,'YXZ');camera.quaternion.setFromEuler(headEuler);
 pilot.rotation.set(-.02*Math.sin(t*.23),glance*.6,Math.sin(t*.7)*.008);
 pilot.position.y=.008*Math.sin(t*1.4);pilot.position.x=.007*Math.sin(t*.9);
 sky.position.copy(camera.position);
 renderer.render(scene,camera);
 return {t,position:[x,f.alt,z],heading:f.airHeading,bank:bank/D,ground:elevation(x,z),triangles:renderer.info.render.triangles};
};
window.sceneReady=true;window.renderFrame(0);
