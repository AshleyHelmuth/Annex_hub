/* inventory.js — the Inventory tab: sidebar, category pages, 10X lots,
 * reserved-quantity math, inline stock edits, and the reservation system.
 * Relies on App.toast / App.drawer / App.reload and window.API. */
window.INV = (function(){
  var data = null;                 // last payload from /api/inventory
  var section = 'update';          // current sub-section id
  var search = '';                 // current search text (per section)
  var expanded = {};               // 10X: expanded kit rows (catalog -> true)
  var elContent = null, elSubnav = null;

  var SECTIONS = [
    { id:'update',       label:'Update inventory', kind:'update', primary:true },
    { id:'tenx',         label:'10X reagents',     kind:'tenx' },
    { id:'reagents',     label:'Reagents & supplies', kind:'reagent', sheet:'Reagents & Supplies', src:'reagents',   subKey:'subcategory', idPrefix:'R'  },
    { id:'oligos',       label:'Oligos',           kind:'reagent', sheet:'Oligos',              src:'oligos',     subKey:'type',        idPrefix:'OL' },
    { id:'totalseq',     label:'TotalSeq + HTOs',  kind:'totalseq' },
    { id:'antibodies',   label:'Antibodies',       kind:'reagent', sheet:'Antibodies',         src:'antibodies', subKey:'subcategory', idPrefix:'AB' },
    { id:'reservations', label:'Edit reservations',kind:'reservations', danger:true },
  ];
  function sec(id){ return SECTIONS.filter(function(s){return s.id===id;})[0]; }

  /* ---------- utilities ---------- */
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function fmt(n){ if(n==null||n==='') return '—'; var x=Number(n); if(!isFinite(x)) return esc(n); return (Math.round(x*100)/100).toLocaleString(); }
  function who(){ try{ return localStorage.getItem('annexhub_who')||''; }catch(e){ return ''; } }
  function setWho(v){ try{ localStorage.setItem('annexhub_who', v||''); }catch(e){} }

  // active reservations indexed by "category|itemKey" and "category|itemKey|lot"
  function resIndex(){
    var byItem={}, byLot={}, listByItem={};
    (data.reservations||[]).forEach(function(r){
      if(r.status!=='active') return;
      var ki=r.category+'|'+r.itemKey;
      byItem[ki]=(byItem[ki]||0)+(r.qty||0);
      (listByItem[ki]=listByItem[ki]||[]).push(r);
      if(r.lot){ var kl=ki+'|'+r.lot; byLot[kl]=(byLot[kl]||0)+(r.qty||0); }
    });
    return { byItem:byItem, byLot:byLot, listByItem:listByItem };
  }

  /* ---------- public ---------- */
  function setData(d){ data=d; }
  function currentSection(){ return section; }

  function render(){
    elContent = document.getElementById('invContent');
    elSubnav  = document.getElementById('subnav');
    if(!data){ return; }
    if(data.configured===false){
      elSubnav.innerHTML='';
      elContent.innerHTML = '<div class="content"><div class="error-box">The live inventory isn\'t connected yet. Set <b>GOOGLE_SA_KEY</b> and <b>INVENTORY_SHEET_ID</b> on this Worker and share the sheet with the service account. See the README.</div></div>';
      return;
    }
    renderSubnav();
    renderSection();
  }

  function renderSubnav(){
    var html='';
    SECTIONS.forEach(function(s){
      if(s.primary){
        html+='<button class="sn-primary" data-sec="'+s.id+'">＋ '+esc(s.label)+'</button>';
        html+='<div class="sn-label">Supply categories</div>';
      } else if(s.danger){
        html+='<div class="sn-label">Reservations</div>';
        html+='<button class="sn-item sn-danger'+(section===s.id?' is-active':'')+'" data-sec="'+s.id+'">'+esc(s.label)+'</button>';
      } else {
        html+='<button class="sn-item'+(section===s.id?' is-active':'')+'" data-sec="'+s.id+'">'+
              '<span>'+esc(s.label)+'</span><span class="sn-count">'+countFor(s)+'</span></button>';
      }
    });
    elSubnav.innerHTML=html;
    Array.prototype.forEach.call(elSubnav.querySelectorAll('[data-sec]'), function(b){
      b.onclick=function(){ section=b.getAttribute('data-sec'); search=''; renderSubnav(); renderSection(); elContent.scrollIntoView({block:'start'}); };
    });
  }
  function countFor(s){
    if(s.kind==='tenx') return (data.tenX||[]).length;
    if(s.kind==='totalseq') return (data.totalseq||[]).length;
    if(s.kind==='reagent') return (data[s.src]||[]).length;
    return '';
  }

  function renderSection(){
    var s=sec(section);
    if(!s){ section='update'; s=sec('update'); }
    if(s.kind==='update') return renderUpdate();
    if(s.kind==='tenx') return render10x();
    if(s.kind==='reagent') return renderReagent(s);
    if(s.kind==='totalseq') return renderTotalseq();
    if(s.kind==='reservations') return renderReservations();
  }

  function pageHead(title, sub, withSearch){
    var h='<div class="page-head"><div><h1>'+esc(title)+'</h1>'+(sub?'<div class="sub">'+esc(sub)+'</div>':'')+'</div>';
    if(withSearch) h+='<div class="search"><input id="invSearch" type="search" placeholder="Search name, catalog #, lot…" value="'+esc(search)+'"></div>';
    h+='</div>';
    return h;
  }
  function wireSearch(rerender){
    var i=document.getElementById('invSearch'); if(!i) return;
    i.oninput=function(){ search=i.value; rerender(); var again=document.getElementById('invSearch'); if(again){ again.focus(); var v=again.value; again.value=''; again.value=v; } };
  }
  function matchText(q, parts){ q=(q||'').toLowerCase().trim(); if(!q) return true; var hay=parts.join(' ').toLowerCase(); return q.split(/\s+/).every(function(t){return hay.indexOf(t)>=0;}); }

  /* ---------- reserved cell (clickable) ---------- */
  function reservedCell(category, itemKey, unit){
    var idx=resIndex(); var ki=category+'|'+itemKey; var amt=idx.byItem[ki]||0;
    if(!amt) return '<span class="metric">reserved <span class="rsv-link none">0</span></span>';
    return '<span class="metric">reserved <span class="rsv-link" data-rsv="'+esc(ki)+'"><b>'+fmt(amt)+'</b>'+(unit?(' '+esc(unit)):'')+'</span></span>';
  }
  function openReservedBreakdown(ki){
    var idx=resIndex(); var list=(idx.listByItem[ki]||[]);
    var name = list.length? list[0].itemName : ki.split('|')[1];
    var html='<div class="res-list">';
    if(!list.length) html+='<div class="empty">No active reservations.</div>';
    list.forEach(function(r){
      html+='<div class="res-item"><div class="r-main"><div><b>'+esc(r.experiment||r.project||'(unlabeled)')+'</b>'+(r.lot?' <span class="key" style="font-family:var(--mono);color:var(--faint)">lot '+esc(r.lot)+'</span>':'')+'</div>'+
            '<div class="r-for">'+esc(r.date||'')+(r.by?' · '+esc(r.by):'')+(r.notes?' · '+esc(r.notes):'')+'</div></div>'+
            '<div style="display:flex;align-items:center;gap:10px"><span class="r-qty">'+fmt(r.qty)+' '+esc(r.unit||'')+'</span>'+
            '<button class="btn btn-sm btn-danger" data-release="'+esc(r.id)+'">Release</button></div></div>';
    });
    html+='</div>';
    App.drawer('Reserved · '+name, html);
    document.querySelectorAll('#sheet [data-release]').forEach(function(b){
      b.onclick=function(){ releaseRes(b.getAttribute('data-release')); };
    });
  }

  /* ---------- UPDATE INVENTORY ---------- */
  function allItemsFlat(){
    var out=[];
    (data.tenX||[]).forEach(function(k){ out.push({category:'10X Kits', key:k.catalog, catalog:k.catalog, name:k.description, kind:'tenx', ref:k}); });
    ['reagents','oligos','antibodies'].forEach(function(src){
      (data[src]||[]).forEach(function(x){ out.push({category:sourceSheet(src), key:x.itemId, catalog:x.catalog||'', name:x.name, kind:'reagent', src:src, ref:x}); });
    });
    (data.totalseq||[]).forEach(function(t){ out.push({category:'Totalseq Cocktails + HTOs', key:t.tubeId, catalog:t.catalog||'', name:(t.storageBox+' '+t.tubeId), kind:'totalseq', ref:t}); });
    return out;
  }
  function sourceSheet(src){ return src==='reagents'?'Reagents & Supplies':src==='oligos'?'Oligos':src==='antibodies'?'Antibodies':src; }

  function renderUpdate(){
    var html = pageHead('Update inventory', 'Find an item by catalog # or name to add or use stock — or add something new.', false);
    html += '<div class="panel">'+
      '<div class="field"><label>Your initials (saved for the log)</label><input id="whoInput" class="mono" placeholder="e.g. AH" value="'+esc(who())+'" style="max-width:160px"></div>'+
      '<div class="field"><label>Catalog # or item ID</label><input id="lookupKey" class="mono" placeholder="e.g. 1000698 or R001" autocomplete="off"></div>'+
      '<div class="field"><label>…or search by name</label><input id="lookupName" placeholder="e.g. Sterile Water, 5\' Chip, HTO" autocomplete="off"><div id="lookupSuggest"></div></div>'+
      '<div id="lookupResult"></div>'+
    '</div>';
    html += '<div id="addNewWrap"></div>';
    elContent.innerHTML='<div class="content">'+html+'</div>';

    document.getElementById('whoInput').onchange=function(){ setWho(this.value.trim()); };
    var key=document.getElementById('lookupKey'), nm=document.getElementById('lookupName');
    key.oninput=function(){ nm.value=''; document.getElementById('lookupSuggest').innerHTML=''; lookupByKey(key.value.trim()); };
    nm.oninput=function(){ key.value=''; document.getElementById('lookupResult').innerHTML=''; suggestByName(nm.value.trim()); };
  }

  function lookupByKey(k){
    var wrap=document.getElementById('lookupResult'); var addWrap=document.getElementById('addNewWrap');
    addWrap.innerHTML='';
    if(!k){ wrap.innerHTML=''; return; }
    var norm=k.replace(/\.0$/,'').toLowerCase();
    var hit=allItemsFlat().filter(function(it){ return String(it.key).toLowerCase()===norm || (it.catalog&&String(it.catalog).toLowerCase()===norm); })[0];
    if(hit){ wrap.innerHTML=''; wrap.appendChild(matchCard(hit)); }
    else {
      wrap.innerHTML='<div class="hint">No item with that catalog #/ID. You can add it as a new item below.</div>';
      addWrap.appendChild(addNewForm(k));
    }
  }
  function suggestByName(q){
    var box=document.getElementById('lookupSuggest'); var wrap=document.getElementById('lookupResult');
    wrap.innerHTML=''; if(!q||q.length<2){ box.innerHTML=''; return; }
    var hits=allItemsFlat().filter(function(it){ return matchText(q,[it.name,it.key,it.catalog,it.category]); }).slice(0,12);
    if(!hits.length){ box.innerHTML='<div class="suggest"><div class="s-item" style="cursor:default;color:var(--faint)">No matches</div></div>'; return; }
    box.innerHTML='<div class="suggest">'+hits.map(function(h,i){
      return '<div class="s-item" data-i="'+i+'">'+esc(h.name||'(unnamed)')+'<span class="key">'+esc(h.key)+' · '+esc(h.category)+'</span></div>';
    }).join('')+'</div>';
    Array.prototype.forEach.call(box.querySelectorAll('[data-i]'), function(el){
      el.onclick=function(){ var h=hits[+el.getAttribute('data-i')]; box.innerHTML=''; document.getElementById('lookupName').value=h.name;
        wrap.innerHTML=''; wrap.appendChild(matchCard(h)); };
    });
  }

  function matchCard(it){
    var d=document.createElement('div'); d.className='match-card';
    var line='';
    if(it.kind==='tenx'){ var idx=resIndex(); var rv=idx.byItem['10X Kits|'+it.key]||0;
      line=fmt(it.ref.boxes)+' kits · '+fmt(it.ref.rxns)+' rxns on hand'+(rv?(' · '+fmt(rv)+' reserved'):'');
    } else if(it.kind==='reagent'){ line=fmt(it.ref.onHandUnits)+' '+esc(it.ref.unit||'')+' on hand ('+fmt(it.ref.onHandContainers)+' '+esc(it.ref.container||'container')+')'; }
    else if(it.kind==='totalseq'){ line=esc(it.ref.remaining)+' remaining · lot '+esc(it.ref.lot||'—'); }
    d.innerHTML='<div class="mc-name">'+esc(it.name)+
      (it.catalog?' <span class="key" style="font-family:var(--mono);color:var(--faint);font-size:12px">#'+esc(it.catalog)+'</span>':'')+
      ' <span class="key" style="font-family:var(--mono);color:var(--faint);font-size:12px">'+esc(it.key)+'</span></div>'+
      '<div class="r-for" style="margin:3px 0 10px">'+line+'</div>'+
      '<div id="mcActions"></div>';
    setTimeout(function(){ mountUpdateActions(d.querySelector('#mcActions'), it); },0);
    return d;
  }

  // Add-stock vs take-out actions inside Update page
  function mountUpdateActions(host, it){
    if(it.kind==='tenx'){
      // choose lot for take-out; add box/lot for add
      var lotOpts=it.ref.lots.map(function(L){ return '<option value="'+esc(L.lot)+'">'+(L.lot?('lot '+esc(L.lot)):'(no lot)')+' · '+fmt(L.rxns)+' rxns · '+fmt(L.boxes)+' box</option>'; }).join('');
      host.innerHTML=''+
        '<div class="seg"><button class="on" data-m="use">Use rxns</button><button data-m="addbox">Add box / lot</button></div>'+
        '<div id="mcBody"></div>';
      var body=host.querySelector('#mcBody');
      function useUI(){ body.innerHTML=
        '<div class="field"><label>Lot</label><select id="u_lot">'+lotOpts+'</select></div>'+
        stepperHTML('u_amt',1)+
        '<div class="field"><label>For experiment (optional)</label><input id="u_exp" placeholder="e.g. BCP batch 13"></div>'+
        '<div class="row-actions"><button class="btn btn-primary" id="u_go">Remove rxns</button></div>';
        wireStepper('u_amt');
        body.querySelector('#u_go').onclick=function(){
          adjust10x('remove', it.key, body.querySelector('#u_lot').value, num('u_amt'), body.querySelector('#u_exp').value);
        };
      }
      function addUI(){ body.innerHTML=
        '<div class="grid2"><div class="field"><label>New lot #</label><input id="a_lot" class="mono"></div>'+
        '<div class="field"><label>Expiry (YYYY-MM-DD)</label><input id="a_exp" class="mono" placeholder="2028-01-01"></div></div>'+
        '<div class="grid2"><div class="field"><label>How many boxes</label><input id="a_cnt" class="mono" value="1"></div>'+
        '<div class="field"><label>Rxns / indexes per box</label><input id="a_rxn" class="mono" placeholder="e.g. 16"></div></div>'+
        '<div class="row-actions"><button class="btn btn-primary" id="a_go">Add box(es)</button></div>';
        body.querySelector('#a_go').onclick=function(){
          add10xBox(it.key, body.querySelector('#a_lot').value, body.querySelector('#a_exp').value, +body.querySelector('#a_cnt').value||1, +body.querySelector('#a_rxn').value||0);
        };
      }
      useUI();
      Array.prototype.forEach.call(host.querySelectorAll('.seg button'),function(b){ b.onclick=function(){
        Array.prototype.forEach.call(host.querySelectorAll('.seg button'),function(x){x.classList.remove('on');}); b.classList.add('on');
        (b.getAttribute('data-m')==='use'?useUI:addUI)();
      };});
      return;
    }
    if(it.kind==='reagent'){
      host.innerHTML=''+
        '<div class="seg"><button class="on" data-m="use">Take out units</button><button data-m="add">Add container(s)</button></div>'+
        '<div id="mcBody"></div>';
      var body=host.querySelector('#mcBody'); var pack=it.ref.packSize||1; var unit=it.ref.unit||'units';
      function useUI(){ body.innerHTML=stepperHTML('r_amt',1,unit)+
        '<div class="field"><label>For experiment (optional)</label><input id="r_exp" placeholder="e.g. ASAP batch"></div>'+
        '<div class="row-actions"><button class="btn btn-primary" id="r_go">Remove '+esc(unit)+'</button></div>';
        wireStepper('r_amt');
        body.querySelector('#r_go').onclick=function(){ adjustReagent(it.src, it.key, 'remove', num('r_amt'), body.querySelector('#r_exp').value); };
      }
      function addUI(){ body.innerHTML=stepperHTML('r_cnt',1,it.ref.container||'container')+
        '<div class="hint">Adds whole '+esc(it.ref.container||'container')+'s of '+fmt(pack)+' '+esc(unit)+' each.</div>'+
        '<div class="row-actions"><button class="btn btn-primary" id="r_add">Add</button></div>';
        wireStepper('r_cnt');
        body.querySelector('#r_add').onclick=function(){ adjustReagent(it.src, it.key, 'add', (num('r_cnt')*pack), 'new container'); };
      }
      useUI();
      Array.prototype.forEach.call(host.querySelectorAll('.seg button'),function(b){ b.onclick=function(){
        Array.prototype.forEach.call(host.querySelectorAll('.seg button'),function(x){x.classList.remove('on');}); b.classList.add('on');
        (b.getAttribute('data-m')==='use'?useUI:addUI)();
      };});
      return;
    }
    if(it.kind==='totalseq'){
      host.innerHTML=stepperHTML('t_amt',1,'uL')+
        '<div class="seg"><button class="on" data-m="remove">Use</button><button data-m="add">Add</button><button data-m="set">Set to</button></div>'+
        '<div class="row-actions"><button class="btn btn-primary" id="t_go">Apply</button></div>';
      wireStepper('t_amt'); var mode='remove';
      Array.prototype.forEach.call(host.querySelectorAll('.seg button'),function(b){ b.onclick=function(){
        Array.prototype.forEach.call(host.querySelectorAll('.seg button'),function(x){x.classList.remove('on');}); b.classList.add('on'); mode=b.getAttribute('data-m'); };});
      host.querySelector('#t_go').onclick=function(){ adjustTotalseq(it.key, mode, num('t_amt')); };
    }
  }

  function stepperHTML(id, val, unitLabel){
    return '<div class="field"><label>Amount'+(unitLabel?(' ('+esc(unitLabel)+')'):'')+'</label>'+
      '<div class="stepper"><button type="button" data-step="'+id+'|-1">−</button>'+
      '<input id="'+id+'" class="mono" inputmode="decimal" value="'+val+'">'+
      '<button type="button" data-step="'+id+'|1">＋</button></div></div>';
  }
  function wireStepper(id){
    Array.prototype.forEach.call(document.querySelectorAll('[data-step]'), function(b){
      var parts=b.getAttribute('data-step').split('|'); if(parts[0]!==id) return;
      b.onclick=function(){ var i=document.getElementById(id); var v=parseFloat(i.value)||0; v+=parseFloat(parts[1]); if(v<0)v=0; i.value=(Math.round(v*100)/100); };
    });
  }
  function num(id){ var i=document.getElementById(id); return Math.max(0, parseFloat(i&&i.value)||0); }

  function addNewForm(prefillKey){
    var d=document.createElement('div'); d.className='panel';
    d.innerHTML='<h2 style="margin-bottom:10px">Add a new item</h2>'+
      '<div class="field"><label>Category</label><select id="n_cat">'+
        '<option value="reagents">Reagents &amp; supplies</option>'+
        '<option value="oligos">Oligos</option>'+
        '<option value="antibodies">Antibodies</option>'+
        '<option value="totalseq">TotalSeq / HTO</option>'+
        '<option value="tenx">10X kit (new catalog #)</option>'+
      '</select></div>'+
      '<div id="n_fields"></div>'+
      '<div class="row-actions"><button class="btn btn-primary" id="n_add">Add new item</button></div>';
    setTimeout(function(){
      var catSel=d.querySelector('#n_cat'); var fields=d.querySelector('#n_fields');
      function draw(){ fields.innerHTML=fieldsFor(catSel.value, prefillKey); }
      catSel.onchange=draw; draw();
      d.querySelector('#n_add').onclick=function(){ submitNew(catSel.value); };
    },0);
    return d;
  }
  function fieldsFor(cat, key){
    var kv = key?esc(key):'';
    if(cat==='tenx') return ''+
      '<div class="grid2"><div class="field"><label>Catalog #</label><input id="f_key" class="mono" value="'+kv+'"></div>'+
      '<div class="field"><label>Experiment group</label><input id="f_exp" placeholder="e.g. 5\' v3"></div></div>'+
      '<div class="field"><label>Description</label><input id="f_name"></div>'+
      '<div class="grid2"><div class="field"><label>Storage</label><input id="f_loc" placeholder="e.g. -20C SHM 301B"></div>'+
      '<div class="field"><label>Reserved for (project)</label><input id="f_resv" placeholder="e.g. BCP"></div></div>'+
      '<div class="grid2"><div class="field"><label>Lot #</label><input id="f_lot" class="mono"></div>'+
      '<div class="field"><label>Expiry</label><input id="f_expiry" class="mono" placeholder="2028-01-01"></div></div>'+
      '<div class="grid2"><div class="field"><label>How many boxes</label><input id="f_cnt" class="mono" value="1"></div>'+
      '<div class="field"><label>Rxns per box</label><input id="f_rxn" class="mono" value="16"></div></div>';
    if(cat==='totalseq') return ''+
      '<div class="grid2"><div class="field"><label>Tube ID</label><input id="f_key" class="mono" value="'+kv+'"></div>'+
      '<div class="field"><label>Storage box / sub-category</label><input id="f_box" placeholder="e.g. TSC HTO (CITEseq Hashtags)"></div></div>'+
      '<div class="grid2"><div class="field"><label>Type</label><input id="f_type" value="HTO"></div>'+
      '<div class="field"><label>TotalSeq version</label><input id="f_ver" placeholder="A / C"></div></div>'+
      '<div class="grid2"><div class="field"><label>Catalog #</label><input id="f_cat" class="mono"></div>'+
      '<div class="field"><label>Lot #</label><input id="f_lot" class="mono"></div></div>'+
      '<div class="grid2"><div class="field"><label>Hashtag #</label><input id="f_ht" class="mono"></div>'+
      '<div class="field"><label>Volume/qty remaining</label><input id="f_qty" class="mono" placeholder="e.g. 16"></div></div>';
    // reagent-shaped (reagents/oligos/antibodies)
    var extra='';
    if(cat==='oligos') extra='<div class="grid2"><div class="field"><label>Type</label><input id="f_type" placeholder="To Use / Stock"></div>'+
      '<div class="field"><label>Concentration</label><input id="f_conc" placeholder="10uM"></div></div>'+
      '<div class="field"><label>Sequence</label><input id="f_seq" class="mono"></div>';
    return ''+
      '<div class="field"><label>Item name</label><input id="f_name"></div>'+
      '<div class="grid2"><div class="field"><label>Sub-category</label><input id="f_sub" placeholder="'+(cat==='reagents'?'Reagent / Supply':cat==='antibodies'?'Antibody':'Oligo')+'"></div>'+
      '<div class="field"><label>Container</label><input id="f_container" placeholder="bottle / tube / aliquot"></div></div>'+
      extra+
      '<div class="grid2"><div class="field"><label>Pack size (units per container)</label><input id="f_pack" class="mono" value="1"></div>'+
      '<div class="field"><label>Unit</label><input id="f_unit" placeholder="mL / uL / rxn"></div></div>'+
      '<div class="grid2"><div class="field"><label>On hand — containers</label><input id="f_cont" class="mono" value="1"></div>'+
      '<div class="field"><label>Reorder at (units)</label><input id="f_reorder" class="mono"></div></div>'+
      '<div class="grid2"><div class="field"><label>Location</label><input id="f_loc"></div>'+
      '<div class="field"><label>Order status</label><input id="f_status" value="stocked"></div></div>';
  }
  function val(id){ var e=document.getElementById(id); return e?e.value.trim():''; }
  function submitNew(cat){
    var by=who();
    if(cat==='tenx'){
      var key=val('f_key'); if(!key) return App.toast('Catalog # is required', true);
      busy(true);
      API.post({ action:'add10xBox', itemKey:key, description:val('f_name'), experiment:val('f_exp'),
        storage:val('f_loc'), reservedFor:val('f_resv'), lot:val('f_lot'), expiry:val('f_expiry'),
        count:+val('f_cnt')||1, rxnsPerBox:+val('f_rxn')||0, by:by })
        .then(afterWrite('Added 10X kit'));
      return;
    }
    if(cat==='totalseq'){
      // append via a small generic: reuse addReagent path won't fit; do a direct reserve-style append through add10x? Use dedicated: we append through adjust? Simplr: not supported server-side yet
      App.toast('Add TotalSeq tubes directly in the sheet for now', true); return;
    }
    var sheet = cat==='oligos'?'Oligos':cat==='antibodies'?'Antibodies':'Reagents & Supplies';
    var prefix = cat==='oligos'?'OL':cat==='antibodies'?'AB':'R';
    var name=val('f_name'); if(!name) return App.toast('Item name is required', true);
    busy(true);
    API.post({ action:'addReagent', sheet:sheet, idPrefix:prefix, name:name,
      subcategory:val('f_sub')|| (cat==='antibodies'?'Antibody':cat==='oligos'?'Oligo':'Reagent'),
      type:val('f_type'), concentration:val('f_conc'), sequence:val('f_seq'),
      container:val('f_container'), packSize:+val('f_pack')||1, unit:val('f_unit'),
      onHandContainers:+val('f_cont')||0, reorderAt:val('f_reorder')?+val('f_reorder'):null,
      location:val('f_loc'), orderStatus:val('f_status')||'stocked', by:by })
      .then(afterWrite('Added item'));
  }

  /* ---------- 10X REAGENTS page ---------- */
  function render10x(){
    var idx=resIndex();
    var kits=(data.tenX||[]).filter(function(k){ return matchText(search,[k.description,k.catalog,k.experiment].concat(k.lots.map(function(L){return L.lot;}))); });
    var groups={}; (data.experiments||[]).forEach(function(e){groups[e]=[];});
    kits.forEach(function(k){ (groups[k.experiment]=groups[k.experiment]||[]).push(k); });
    var order=Object.keys(groups).filter(function(g){return groups[g].length;}).sort();
    var html=pageHead('10X reagents','Grouped by assay. Expand a kit to edit or reserve a specific lot.', true);
    if(!order.length) html+='<div class="empty">No kits match “'+esc(search)+'”.</div>';
    order.forEach(function(g){
      var list=groups[g].sort(function(a,b){return a.description.localeCompare(b.description);});
      var toOrder=0; // 10X has no reorder threshold wired; skip
      html+='<details class="group" open><summary><span class="caret">▸</span><span class="g-title">'+esc(g)+'</span>'+
            '<span class="g-meta">'+list.length+' kit'+(list.length>1?'s':'')+'</span></summary><div class="rows">';
      list.forEach(function(k){
        var ki='10X Kits|'+k.catalog; var rv=idx.byItem[ki]||0; var avail=k.rxns-rv;
        var isOpen=!!expanded[k.catalog];
        html+='<div class="irow'+(isOpen?' expanded':'')+'" data-cat="'+esc(k.catalog)+'">'+
          '<div class="nm">'+esc(k.description)+'<span class="key">'+esc(k.catalog)+'</span>'+
            (k.reservedFor?'<span class="flag lock">'+esc(k.reservedFor)+'</span>':'')+'</div>'+
          '<div class="metrics">'+
            '<span class="metric">on hand <b>'+fmt(k.boxes)+'</b> kits · <b>'+fmt(k.rxns)+'</b> rxns</span>'+
            reservedCell('10X Kits', k.catalog, 'rxns')+
            '<span class="metric avail">avail <b>'+fmt(avail)+'</b> rxns</span>'+
            '<button class="expand-btn" data-exp="'+esc(k.catalog)+'">'+(isOpen?'Hide lots':(k.lots.length+' lot'+(k.lots.length>1?'s':'')))+'</button>'+
          '</div>'+
          '<div class="lots">'+k.lots.map(function(L){ return lotRow(k,L,idx); }).join('')+'</div>'+
        '</div>';
      });
      html+='</div></details>';
    });
    elContent.innerHTML='<div class="content">'+html+'</div>';
    wireSearch(render10x);
    // expand toggles
    Array.prototype.forEach.call(elContent.querySelectorAll('[data-exp]'),function(b){
      b.onclick=function(){ var c=b.getAttribute('data-exp'); expanded[c]=!expanded[c]; render10x(); };
    });
    wireReservedLinks();
    wireLotControls();
  }
  function lotRow(k, L, idx){
    var rvLot=idx.byLot['10X Kits|'+k.catalog+'|'+(L.lot||'')]||0;
    var availLot=L.rxns-rvLot;
    return '<div class="lot" data-lot="'+esc(L.lot)+'" data-cat="'+esc(k.catalog)+'">'+
      '<span class="lotno">'+(L.lot?('Lot '+esc(L.lot)):'(no lot)')+'</span>'+
      '<span class="lotmeta">'+fmt(L.boxes)+' box · '+fmt(L.rxns)+' rxns'+(L.expiry?(' · exp '+esc(L.expiry)):'')+(rvLot?(' · '+fmt(rvLot)+' reserved'):'')+'</span>'+
      '<span class="lotmeta" style="color:var(--teal-d);font-weight:600">avail '+fmt(availLot)+'</span>'+
      '<span style="flex:1"></span>'+
      '<button class="btn btn-sm" data-lotuse="1">Use</button>'+
      '<button class="btn btn-sm" data-lotresv="1">Reserve</button>'+
    '</div>';
  }
  function wireLotControls(){
    Array.prototype.forEach.call(elContent.querySelectorAll('.lot [data-lotuse]'),function(b){
      b.onclick=function(){ var lot=b.closest('.lot'); openUseLot(lot.getAttribute('data-cat'), lot.getAttribute('data-lot')); };
    });
    Array.prototype.forEach.call(elContent.querySelectorAll('.lot [data-lotresv]'),function(b){
      b.onclick=function(){ var lot=b.closest('.lot'); openReserveForm({category:'10X Kits', itemKey:lot.getAttribute('data-cat'), lot:lot.getAttribute('data-lot'), unit:'rxns', name:kitName(lot.getAttribute('data-cat'))}); };
    });
  }
  function kitName(cat){ var k=(data.tenX||[]).filter(function(x){return x.catalog===cat;})[0]; return k?k.description:cat; }
  function openUseLot(cat, lot){
    var html='<div class="field"><label>Remove rxns from lot '+esc(lot||'(no lot)')+'</label></div>'+
      stepperHTML('lu_amt',1,'rxns')+
      '<div class="field"><label>For experiment (optional)</label><input id="lu_exp"></div>'+
      '<div class="row-actions"><button class="btn btn-primary" id="lu_go">Remove</button></div>';
    App.drawer('Use · '+kitName(cat), html);
    wireStepper('lu_amt');
    document.getElementById('lu_go').onclick=function(){ App.closeDrawer(); adjust10x('remove', cat, lot, num('lu_amt'), val('lu_exp')); };
  }

  /* ---------- REAGENT-shaped page ---------- */
  function renderReagent(s){
    var idx=resIndex();
    var items=(data[s.src]||[]).filter(function(x){ return matchText(search,[x.name,x.itemId,x.subcategory,x.type]); });
    var groups={};
    items.forEach(function(x){ var g=(x[s.subKey]||'Other')||'Other'; (groups[g]=groups[g]||[]).push(x); });
    var order=Object.keys(groups).sort();
    var html=pageHead(s.label, null, true);
    if(!items.length) html+='<div class="empty">Nothing matches '+(search?('“'+esc(search)+'”'):'yet')+'.</div>';
    order.forEach(function(g){
      var list=groups[g].sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
      var toOrder=list.filter(function(x){ return reorderState(x, idx)!=='ok'; }).length;
      html+='<details class="group" open><summary><span class="caret">▸</span><span class="g-title">'+esc(g)+'</span>'+
            '<span class="g-meta">'+list.length+' item'+(list.length>1?'s':'')+(toOrder?(' · '+toOrder+' low'):'')+'</span></summary><div class="rows">';
      list.forEach(function(x){ html+=reagentRow(s, x, idx); });
      html+='</div></details>';
    });
    elContent.innerHTML='<div class="content">'+html+'</div>';
    wireSearch(function(){ renderReagent(s); });
    wireReservedLinks();
    wireReagentControls(s);
  }
  function reorderState(x, idx){
    var rv=idx.byItem[(x._sheet||'')+'|'+x.itemId]||0;
    var avail=(x.onHandUnits||0)-rv;
    if((x.onHandUnits||0)<=0) return 'out';
    if(x.reorderAt!=null && avail<=x.reorderAt) return 'reorder';
    return 'ok';
  }
  function reagentRow(s, x, idx){
    var category=s.sheet; x._sheet=category;
    var rv=idx.byItem[category+'|'+x.itemId]||0; var avail=(x.onHandUnits||0)-rv;
    var st = (x.onHandUnits||0)<=0?'out':(x.reorderAt!=null && avail<=x.reorderAt?'reorder':'ok');
    var flag = st==='out'?'<span class="flag out">out</span>':st==='reorder'?'<span class="flag reorder">reorder</span>':'';
    return '<div class="irow" data-key="'+esc(x.itemId)+'">'+
      '<div class="nm">'+esc(x.name||'(unnamed)')+
        (x.catalog?'<span class="key" title="Catalog #">#'+esc(x.catalog)+'</span>':'')+
        '<span class="key" title="Item ID">'+esc(x.itemId)+'</span>'+
        (x.vendor?'<span class="key" title="Vendor">'+esc(x.vendor)+'</span>':'')+
        (x.concentration?'<span class="tag">'+esc(x.concentration)+'</span>':'')+' '+flag+'</div>'+
      '<div class="metrics">'+
        '<span class="metric">on hand <b>'+fmt(x.onHandUnits)+'</b> '+esc(x.unit||'')+'</span>'+
        reservedCell(category, x.itemId, x.unit)+
        '<span class="metric '+(st==='out'?'zero':st==='reorder'?'low':'avail')+'">avail <b>'+fmt(avail)+'</b> '+esc(x.unit||'')+'</span>'+
      '</div>'+
      '<div class="qty">'+
        '<div class="stepper"><button data-adj="'+esc(x.itemId)+'|-1">−</button><input class="qv" id="q_'+esc(x.itemId)+'" value="1" inputmode="decimal"><button data-adj="'+esc(x.itemId)+'|1">＋</button></div>'+
        '<button class="btn btn-sm" data-take="'+esc(x.itemId)+'">Take out</button>'+
        '<button class="btn btn-sm" data-addc="'+esc(x.itemId)+'">＋ '+esc(x.container||'container')+' ('+fmt(x.packSize)+')</button>'+
        '<button class="btn btn-sm btn-ghost" data-resv="'+esc(x.itemId)+'">Reserve</button>'+
      '</div>'+
    '</div>';
  }
  function wireReagentControls(s){
    var map={}; (data[s.src]||[]).forEach(function(x){ map[x.itemId]=x; });
    Array.prototype.forEach.call(elContent.querySelectorAll('[data-adj]'),function(b){
      b.onclick=function(){ var p=b.getAttribute('data-adj').split('|'); var i=document.getElementById('q_'+p[0]); var v=parseFloat(i.value)||0; v+=parseFloat(p[1]); if(v<0)v=0; i.value=Math.round(v*100)/100; };
    });
    Array.prototype.forEach.call(elContent.querySelectorAll('[data-take]'),function(b){
      b.onclick=function(){ var id=b.getAttribute('data-take'); var v=parseFloat(document.getElementById('q_'+id).value)||0; if(v<=0) return App.toast('Enter an amount', true);
        adjustReagent(s.src, id, 'remove', v, ''); };
    });
    Array.prototype.forEach.call(elContent.querySelectorAll('[data-addc]'),function(b){
      b.onclick=function(){ var id=b.getAttribute('data-addc'); var x=map[id]; var v=parseFloat(document.getElementById('q_'+id).value)||1; adjustReagent(s.src, id, 'add', v*(x.packSize||1), 'new container'); };
    });
    Array.prototype.forEach.call(elContent.querySelectorAll('[data-resv]'),function(b){
      b.onclick=function(){ var x=map[b.getAttribute('data-resv')]; openReserveForm({category:s.sheet, itemKey:x.itemId, unit:x.unit, name:x.name}); };
    });
  }

  /* ---------- TOTALSEQ page ---------- */
  function renderTotalseq(){
    var idx=resIndex();
    var items=(data.totalseq||[]).filter(function(t){ return matchText(search,[t.tubeId,t.storageBox,t.catalog,t.lot,t.hashtag,t.version]); });
    var groups={}; items.forEach(function(t){ var g=t.storageBox||'Other'; (groups[g]=groups[g]||[]).push(t); });
    var order=Object.keys(groups).sort();
    var html=pageHead('TotalSeq cocktails + HTOs', 'Grouped by storage box.', true);
    if(!items.length) html+='<div class="empty">Nothing matches '+(search?('“'+esc(search)+'”'):'yet')+'.</div>';
    order.forEach(function(g){
      var list=groups[g].sort(function(a,b){ return String(a.tubeId).localeCompare(String(b.tubeId), undefined, {numeric:true}); });
      html+='<details class="group"'+(list.length<=40?' open':'')+'><summary><span class="caret">▸</span><span class="g-title">'+esc(g)+'</span>'+
            '<span class="g-meta">'+list.length+' tube'+(list.length>1?'s':'')+'</span></summary><div class="rows">';
      list.forEach(function(t){
        var rv=idx.byItem['Totalseq Cocktails + HTOs|'+t.tubeId]||0;
        var cur=parseFloat(String(t.remaining).replace(/[^0-9.\-]/g,'')); var hasNum=isFinite(cur);
        html+='<div class="irow" data-tube="'+esc(t.tubeId)+'">'+
          '<div class="nm">'+esc(t.tubeId)+(t.hashtag?'<span class="tag">HTO '+esc(t.hashtag)+'</span>':'')+
            (t.catalog?'<span class="key" title="Catalog #">#'+esc(t.catalog)+'</span>':'')+
            '<span class="key">'+esc(t.version?('v'+t.version):'')+(t.lot?(' · '+t.lot):'')+'</span></div>'+
          '<div class="metrics">'+
            '<span class="metric">remaining <b>'+esc(t.remaining||'—')+'</b></span>'+
            reservedCell('Totalseq Cocktails + HTOs', t.tubeId, 'uL')+
          '</div>'+
          '<div class="qty">'+
            '<div class="stepper"><button data-tadj="'+esc(t.tubeId)+'|-1">−</button><input id="tq_'+esc(t.tubeId)+'" value="1" inputmode="decimal"><button data-tadj="'+esc(t.tubeId)+'|1">＋</button></div>'+
            '<button class="btn btn-sm" data-tuse="'+esc(t.tubeId)+'">Use</button>'+
            '<button class="btn btn-sm" data-tadd="'+esc(t.tubeId)+'">Add</button>'+
            '<button class="btn btn-sm btn-ghost" data-tset="'+esc(t.tubeId)+'">Set</button>'+
            '<button class="btn btn-sm btn-ghost" data-tresv="'+esc(t.tubeId)+'">Reserve</button>'+
          '</div>'+
        '</div>';
      });
      html+='</div></details>';
    });
    elContent.innerHTML='<div class="content">'+html+'</div>';
    wireSearch(renderTotalseq);
    wireReservedLinks();
    function amt(id){ return Math.max(0, parseFloat(document.getElementById('tq_'+id).value)||0); }
    Array.prototype.forEach.call(elContent.querySelectorAll('[data-tadj]'),function(b){
      b.onclick=function(){ var p=b.getAttribute('data-tadj').split('|'); var i=document.getElementById('tq_'+p[0]); var v=parseFloat(i.value)||0; v+=parseFloat(p[1]); if(v<0)v=0; i.value=Math.round(v*100)/100; };
    });
    Array.prototype.forEach.call(elContent.querySelectorAll('[data-tuse]'),function(b){ b.onclick=function(){ adjustTotalseq(b.getAttribute('data-tuse'),'remove',amt(b.getAttribute('data-tuse'))); };});
    Array.prototype.forEach.call(elContent.querySelectorAll('[data-tadd]'),function(b){ b.onclick=function(){ adjustTotalseq(b.getAttribute('data-tadd'),'add',amt(b.getAttribute('data-tadd'))); };});
    Array.prototype.forEach.call(elContent.querySelectorAll('[data-tset]'),function(b){ b.onclick=function(){ adjustTotalseq(b.getAttribute('data-tset'),'set',amt(b.getAttribute('data-tset'))); };});
    Array.prototype.forEach.call(elContent.querySelectorAll('[data-tresv]'),function(b){ b.onclick=function(){ var t=(data.totalseq||[]).filter(function(x){return x.tubeId===b.getAttribute('data-tresv');})[0]; openReserveForm({category:'Totalseq Cocktails + HTOs', itemKey:t.tubeId, lot:t.lot, unit:'uL', name:t.storageBox+' '+t.tubeId}); };});
  }

  /* ---------- RESERVATIONS page ---------- */
  function renderReservations(){
    var active=(data.reservations||[]).filter(function(r){return r.status==='active';});
    var html=pageHead('Reservations', 'Active reservations reduce the available amount everywhere. Release one to free it up.', false);
    html+='<div class="panel"><div class="row-actions"><button class="btn btn-primary" id="newResBtn">＋ New reservation</button></div></div>';
    // group by category
    var byCat={}; active.forEach(function(r){ (byCat[r.category]=byCat[r.category]||[]).push(r); });
    var order=Object.keys(byCat).sort();
    if(!active.length) html+='<div class="empty">No active reservations. New reservations you make here — or that the planner creates — will show up across all the category pages.</div>';
    order.forEach(function(cat){
      html+='<details class="group" open><summary><span class="caret">▸</span><span class="g-title">'+esc(cat)+'</span><span class="g-meta">'+byCat[cat].length+'</span></summary><div class="rows" style="padding:6px 14px">';
      byCat[cat].forEach(function(r){
        html+='<div class="res-item"><div class="r-main"><div><b>'+esc(r.itemName||r.itemKey)+'</b> <span class="key" style="font-family:var(--mono);color:var(--faint);font-size:12px">'+esc(r.itemKey)+(r.lot?(' · lot '+esc(r.lot)):'')+'</span></div>'+
          '<div class="r-for">'+esc(r.experiment||r.project||'(unlabeled)')+' · '+esc(r.date||'')+(r.by?(' · '+esc(r.by)):'')+'</div></div>'+
          '<div style="display:flex;align-items:center;gap:10px"><span class="r-qty">'+fmt(r.qty)+' '+esc(r.unit||'')+'</span>'+
          '<button class="btn btn-sm btn-danger" data-release="'+esc(r.id)+'">Release</button></div></div>';
      });
      html+='</div></details>';
    });
    elContent.innerHTML='<div class="content">'+html+'</div>';
    document.getElementById('newResBtn').onclick=function(){ openReserveForm({}); };
    Array.prototype.forEach.call(elContent.querySelectorAll('[data-release]'),function(b){ b.onclick=function(){ releaseRes(b.getAttribute('data-release')); };});
  }

  function openReserveForm(pre){
    pre=pre||{};
    var items=allItemsFlat();
    var html='';
    if(!pre.itemKey){
      html+='<div class="field"><label>Item</label><input id="rf_search" placeholder="Search name or catalog #…" autocomplete="off"><div id="rf_suggest"></div></div>';
    } else {
      html+='<div class="match-card"><div class="mc-name">'+esc(pre.name||pre.itemKey)+'</div><div class="r-for">'+esc(pre.category)+' · '+esc(pre.itemKey)+(pre.lot?(' · lot '+esc(pre.lot)):'')+'</div></div>';
    }
    html+=stepperHTML('rf_qty',1,pre.unit||'units')+
      '<div class="grid2"><div class="field"><label>Experiment</label><input id="rf_exp" placeholder="e.g. BCP batch 13"></div>'+
      '<div class="field"><label>Project</label><input id="rf_proj" placeholder="e.g. BCP"></div></div>'+
      '<div class="field"><label>Notes (optional)</label><input id="rf_notes"></div>'+
      '<div class="row-actions"><button class="btn btn-primary" id="rf_go">Reserve</button></div>';
    App.drawer('New reservation', html);
    wireStepper('rf_qty');
    var chosen = pre.itemKey? {category:pre.category, itemKey:pre.itemKey, itemName:pre.name, unit:pre.unit, lot:pre.lot} : null;
    if(!pre.itemKey){
      var si=document.getElementById('rf_search'); var box=document.getElementById('rf_suggest');
      si.oninput=function(){ var q=si.value.trim(); if(q.length<2){box.innerHTML='';return;}
        var hits=items.filter(function(it){return matchText(q,[it.name,it.key,it.catalog,it.category]);}).slice(0,10);
        box.innerHTML='<div class="suggest">'+hits.map(function(h,i){return '<div class="s-item" data-i="'+i+'">'+esc(h.name||'(unnamed)')+'<span class="key">'+esc(h.key)+' · '+esc(h.category)+'</span></div>';}).join('')+'</div>';
        Array.prototype.forEach.call(box.querySelectorAll('[data-i]'),function(el){ el.onclick=function(){ var h=hits[+el.getAttribute('data-i')];
          chosen={category:h.category, itemKey:h.key, itemName:h.name, unit:(h.kind==='tenx'?'rxns':(h.ref.unit||'units'))};
          si.value=h.name; box.innerHTML='<div class="hint">Selected: '+esc(h.key)+' · '+esc(h.category)+'</div>'; };});
      };
    }
    document.getElementById('rf_go').onclick=function(){
      if(!chosen) return App.toast('Pick an item first', true);
      var qty=num('rf_qty'); if(qty<=0) return App.toast('Enter a quantity', true);
      App.closeDrawer(); busy(true);
      API.post({ action:'reserve', category:chosen.category, itemKey:chosen.itemKey, lot:chosen.lot||'',
        itemName:chosen.itemName||'', qty:qty, unit:chosen.unit||'', experiment:val('rf_exp'), project:val('rf_proj'),
        notes:val('rf_notes'), by:who() }).then(afterWrite('Reserved'));
    };
  }
  function releaseRes(id){
    busy(true);
    API.post({ action:'releaseReservation', reservationId:id, by:who() }).then(afterWrite('Reservation released'));
  }

  /* ---------- write helpers ---------- */
  function adjustReagent(src, key, mode, amount, exp){
    var sheet = src==='reagents'?'Reagents & Supplies':src==='oligos'?'Oligos':'Antibodies';
    busy(true);
    API.post({ action:'adjustReagent', sheet:sheet, itemKey:key, mode:mode, amount:amount, experiment:exp||'', by:who() })
      .then(afterWrite(mode==='remove'?'Removed '+fmt(amount):'Added '+fmt(amount)));
  }
  function adjust10x(mode, cat, lot, amount, exp){
    if(amount<=0) return App.toast('Enter an amount', true);
    busy(true);
    API.post({ action:'adjust10x', itemKey:cat, lot:lot, mode:mode, amount:amount, experiment:exp||'', by:who() })
      .then(afterWrite(mode==='remove'?'Removed '+fmt(amount)+' rxns':'Updated'));
  }
  function add10xBox(cat, lot, expiry, count, rxnsPerBox){
    busy(true);
    API.post({ action:'add10xBox', itemKey:cat, lot:lot, expiry:expiry, count:count, rxnsPerBox:rxnsPerBox, by:who() })
      .then(afterWrite('Added '+count+' box'+(count>1?'es':'')));
  }
  function adjustTotalseq(tube, mode, amount){
    if(amount<=0 && mode!=='set') return App.toast('Enter an amount', true);
    busy(true);
    API.post({ action:'adjustTotalseq', itemKey:tube, mode:mode, amount:amount, by:who() })
      .then(afterWrite(mode==='remove'?'Used '+fmt(amount):mode==='set'?'Set to '+fmt(amount):'Added '+fmt(amount)));
  }
  function afterWrite(msg){
    return function(d){
      if(d && d.ok){ App.toast(msg); App.reload(); }
      else { busy(false); App.toast('Error: '+((d&&d.error)||'write failed'), true); }
    };
  }
  function busy(on){ App.setBusy(on); }

  function wireReservedLinks(){
    Array.prototype.forEach.call(elContent.querySelectorAll('.rsv-link[data-rsv]'),function(el){
      el.onclick=function(){ openReservedBreakdown(el.getAttribute('data-rsv')); };
    });
  }

  return { setData:setData, render:render, currentSection:currentSection };
})();
