// Optional fixture preparation. The generated WebM is supplied in demo/public/demo/.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const label="drawbox=x=0:y=ih-84:w=iw:h=84:color=black@0.8:t=fill,drawtext=text='SYNTHETIC TEST VIDEO - NOT A FLIGHT CAMERA':fontcolor=white:fontsize=18:x=14:y=h-72,drawtext=text='Pattern time %{pts\\:hms} - 90 second clip':fontcolor=white:fontsize=18:x=14:y=h-40";
const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=12:duration=90','-vf',label,'-c:v','libvpx-vp9','-b:v','220k','-an','-y',fileURLToPath(new URL('../demo/public/demo/demo.webm',import.meta.url))],{stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status ?? 1;
