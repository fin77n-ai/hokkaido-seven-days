// 每日路线图底图：打开某天的路线图时，从 OpenFreeMap 取 OpenStreetMap 矢量瓦片，画出道路、铁路、河流、水面和公园轮廓。
// 瓦片由 sw.js 存进 MAP_CACHE，看过一次以后离线也能显示；取不到就只显示路线和站点。
(function(){
  var TJ='https://tiles.openfreemap.org/planet', Z=14;
  function tplUrl(){
    var saved=store.get('hokkaido-tile-tpl');
    if(saved) return Promise.resolve(saved);
    return fetch(TJ).then(function(r){return r.json();}).then(function(j){ store.set('hokkaido-tile-tpl',j.tiles[0]); return j.tiles[0]; });
  }
  // ---- minimal Mapbox Vector Tile decoder (protobuf varints, packed geometry) ----
  function Reader(buf){ this.b=new Uint8Array(buf); this.p=0; }
  Reader.prototype.v=function(){ var b=this.b,r=0,s=1,c; do{ c=b[this.p++]; r+=(c&127)*s; s*=128; }while(c>=128); return r; };
  Reader.prototype.skip=function(t){ if(t===0) this.v(); else if(t===2) this.p+=this.v(); else if(t===5) this.p+=4; else if(t===1) this.p+=8; };
  Reader.prototype.str=function(n){ var s=this.b.subarray(this.p,this.p+n); this.p+=n; return new TextDecoder().decode(s); };
  function packed(r){ var n=r.v(),end=r.p+n,o=[]; while(r.p<end) o.push(r.v()); return o; }
  function value(r,end){ var v=null; while(r.p<end){ var k=r.v(),f=k>>3,t=k&7; if(f===1) v=r.str(r.v()); else if(f===7) v=!!r.v(); else r.skip(t); } return v; }
  function layers(buf){
    var r=new Reader(buf),out={};
    while(r.p<r.b.length){
      var k=r.v(); if((k>>3)!==3){ r.skip(k&7); continue; }
      var end=r.v()+r.p,L={name:'',keys:[],vals:[],feats:[],ext:4096};
      while(r.p<end){
        var k2=r.v(),f=k2>>3,t=k2&7;
        if(f===1) L.name=r.str(r.v());
        else if(f===2){ var fe=r.v()+r.p,F={tags:[],type:0,geom:[]}; while(r.p<fe){ var k3=r.v(),g=k3>>3; if(g===2) F.tags=packed(r); else if(g===3) F.type=r.v(); else if(g===4) F.geom=packed(r); else r.skip(k3&7); } L.feats.push(F); }
        else if(f===3) L.keys.push(r.str(r.v()));
        else if(f===4){ var ve=r.v()+r.p; L.vals.push(value(r,ve)); r.p=ve; }
        else if(f===5) L.ext=r.v();
        else r.skip(t);
      }
      out[L.name]=L;
    }
    return out;
  }
  function props(L,F){ var o={}; for(var i=0;i<F.tags.length;i+=2) o[L.keys[F.tags[i]]]=L.vals[F.tags[i+1]]; return o; }
  function rings(F){ // tile-pixel coordinates, one array per MoveTo
    var g=F.geom,i=0,x=0,y=0,out=[],cur=null;
    while(i<g.length){
      var c=g[i++],id=c&7,n=c>>3;
      if(id===7){ if(cur) cur.close=true; continue; }
      for(var j=0;j<n;j++){
        var dx=g[i++],dy=g[i++]; x+=(dx>>>1)^-(dx&1); y+=(dy>>>1)^-(dy&1);
        if(id===1){ cur=[[x,y]]; out.push(cur); } else cur.push([x,y]);
      }
    }
    return out;
  }
  function lon2t(lon){ return (lon+180)/360*(1<<Z); }
  function lat2t(lat){ var r=lat*Math.PI/180; return (1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*(1<<Z); }
  function t2lat(t){ var n=Math.PI-2*Math.PI*t/(1<<Z); return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))); }
  function classify(layer,p){
    if(layer==='transportation'){
      if(p.brunnel==='tunnel') return null;
      var c=p['class']||'';
      if(/^(motorway|trunk|primary)$/.test(c)) return 'r1';
      if(/^(secondary|tertiary)$/.test(c)) return 'r2';
      if(c==='minor') return 'r3';
      if(c==='rail') return 'rail';
      return null;
    }
    if(layer==='water') return 'water';
    if(layer==='waterway') return /river|canal/.test(p['class']||'')?'river':null;
    if(layer==='park') return 'park';
    if(layer==='landcover') return (p.subclass==='park'||p.subclass==='garden')?'park':null;
    return null;
  }
  function draw(g){
    var bb=g.getAttribute('data-bb').split(',').map(Number),W=+g.getAttribute('data-w'),H=+g.getAttribute('data-h'),minor=g.getAttribute('data-minor')==='1';
    var x0=Math.floor(lon2t(bb[0])),x1=Math.floor(lon2t(bb[2])),y0=Math.floor(lat2t(bb[3])),y1=Math.floor(lat2t(bb[1]));
    var px=function(tx,ty,ext,p){ var lon=(tx+p[0]/ext)/(1<<Z)*360-180,lat=t2lat(ty+p[1]/ext); return Math.round((lon-bb[0])/(bb[2]-bb[0])*W)+' '+Math.round((bb[3]-lat)/(bb[3]-bb[1])*H); };
    var acc={park:[],water:[],river:[],r3:[],r2:[],r1:[],rail:[]},jobs=[];
    g.setAttribute('data-state','loading');
    return tplUrl().then(function(tpl){
      for(var tx=x0;tx<=x1;tx++) for(var ty=y0;ty<=y1;ty++) (function(tx,ty){
        jobs.push(fetch(tpl.replace('{z}',Z).replace('{x}',tx).replace('{y}',ty)).then(function(r){ if(!r.ok) throw r.status; return r.arrayBuffer(); }).then(function(buf){
          var ls=layers(buf);
          ['water','park','landcover','waterway','transportation'].forEach(function(name){
            var L=ls[name]; if(!L) return;
            L.feats.forEach(function(F){
              var cls=classify(name,props(L,F)); if(!cls||(cls==='r3'&&!minor)) return;
              var poly=F.type===3;
              rings(F).forEach(function(rg){ if(rg.length<2) return; acc[cls].push('M'+rg.map(function(p){return px(tx,ty,L.ext,p);}).join('L')+(poly?'Z':'')); });
            });
          });
        }));
      })(tx,ty);
      return Promise.all(jobs);
    }).then(function(){
      var html='';
      Object.keys(acc).forEach(function(c){ if(acc[c].length){ html+='<path class="rm-'+c+'" d="'+acc[c].join('')+'"/>'; if(c==='rail') html+='<path class="rm-rail-d" d="'+acc[c].join('')+'"/>'; } });
      g.innerHTML=html; g.setAttribute('data-state','ok');
    }).catch(function(){ g.setAttribute('data-state','off'); store.set('hokkaido-tile-tpl',''); });
  }
  document.querySelectorAll('details.route-map').forEach(function(d){
    d.addEventListener('toggle',function(){
      var g=d.querySelector('.rm-base');
      if(d.open&&g&&g.getAttribute('data-state')!=='ok'&&g.getAttribute('data-state')!=='loading') draw(g);
    });
  });
})();
