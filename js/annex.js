/* annex.js — Annex Usage tab: schedule an experiment (space usage), a
 * chronological list of upcoming experiments, and a mini calendar summary.
 * Backed by the "Annex Experiments" tab in the same Google Sheet via /api/experiments. */
window.Annex = (function(){
  var mounted=false;
  var editing=null;            // entryId currently being edited, or null
  var data=[];                 // active experiments
  var calMonth=firstOfMonth(new Date());
  var filterDay=null;          // ISO string when a calendar day is selected

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function isoOf(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function todayISO(){ return isoOf(new Date()); }
  function firstOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
  function who(){ try{ return localStorage.getItem('annexhub_name')||localStorage.getItem('annexhub_who')||''; }catch(e){ return ''; } }
  function setWho(v){ try{ localStorage.setItem('annexhub_name', v||''); }catch(e){} }
  function coversDay(x, iso){ var s=x.startDate, e=x.endDate||x.startDate; return s && iso>=s && iso<=e; }
  function fmtRange(x){
    var d = x.startDate + (x.endDate && x.endDate!==x.startDate ? ' – '+x.endDate : '');
    var t = (x.startTime||x.endTime) ? (' · '+(x.startTime||'?')+(x.endTime?('–'+x.endTime):'')) : '';
    return d+t;
  }
  function toast(m,e){ if(window.App&&App.toast) App.toast(m,e); }

  function mount(){
    var host=document.getElementById('view-annex'); if(!host) return;
    if(!mounted){ renderShell(host); mounted=true; }
    load();
  }

  function renderShell(host){
    host.innerHTML='<div class="content">'+
      '<div class="page-head"><div><h1>Annex usage</h1><div class="sub">Schedule an experiment in the Annex space and see what\u2019s coming up.</div></div></div>'+
      '<div id="annexMsg"></div>'+
      '<details class="group" id="expFormWrap"><summary><span class="caret">▸</span><span class="g-title" id="ax_formtitle">＋ Schedule an experiment</span></summary>'+
        '<div style="padding:14px">'+
          '<div class="grid2"><div class="field"><label>Experiment ID</label><input id="ax_id" class="mono" placeholder="e.g. BCP-013"></div>'+
          '<div class="field"><label>Experiment name *</label><input id="ax_name" placeholder="e.g. BCP batch 13 GEM prep"></div></div>'+
          '<div class="grid2"><div class="field"><label>Project</label><input id="ax_proj" placeholder="e.g. BCP"></div>'+
          '<div class="field"><label>Operators</label><input id="ax_ops" placeholder="e.g. Ashley, Rory"></div></div>'+
          '<div class="field"><label>Purpose</label><input id="ax_purpose" placeholder="short description"></div>'+
          '<div class="grid2"><div class="field"><label>Start date *</label><input id="ax_sd" type="date"></div>'+
          '<div class="field"><label>End date</label><input id="ax_ed" type="date"></div></div>'+
          '<div class="grid2"><div class="field"><label>Start time</label><input id="ax_st" type="time"></div>'+
          '<div class="field"><label>End time</label><input id="ax_et" type="time"></div></div>'+
          '<div class="grid2">'+
            '<label class="ax-check"><input type="checkbox" id="ax_biohub"> Affiliated with Biohub</label>'+
            '<label class="ax-check"><input type="checkbox" id="ax_whole"> Entire space needed</label>'+
          '</div>'+
          '<div class="grid2"><div class="field"><label>Your name</label><input id="ax_who" placeholder="e.g. Ashley Helmuth" value="'+esc(who())+'"></div><div></div></div>'+
          '<div class="row-actions"><button class="btn btn-primary" id="ax_add">Add experiment</button>'+
            '<button class="btn btn-ghost" id="ax_canceledit" style="display:none">Cancel edit</button></div>'+
        '</div>'+
      '</details>'+
      '<div class="page-head" style="margin:4px 0 8px"><div><h2>Upcoming experiments</h2><div class="sub" id="ax_listsub">Soonest first.</div></div><button class="btn btn-sm" id="ax_refresh">↻ Refresh</button></div>'+
      '<div id="ax_list"><div class="hint">Loading…</div></div>'+
      '<details class="group" id="pastWrap" style="margin-top:12px"><summary><span class="caret">▸</span><span class="g-title">Past experiments</span><span class="g-meta" id="ax_pastcount"></span></summary>'+
        '<div style="padding:12px 14px" id="ax_pastlist"></div></details>'+
      '<div class="page-head" style="margin:16px 0 8px"><div><h2>Calendar summary</h2><div class="sub">Days with experiments are marked; solid = whole space.</div></div></div>'+
      '<div class="panel" id="ax_cal"></div>'+
    '</div>';
    document.getElementById('ax_who').onchange=function(){ setWho(this.value.trim()); };
    document.getElementById('ax_add').onclick=submitExperiment;
    document.getElementById('ax_canceledit').onclick=cancelEdit;
    document.getElementById('ax_refresh').onclick=load;
    // default start date = today
    var sd=document.getElementById('ax_sd'); if(sd) sd.value=todayISO();
  }

  function load(){
    fetch('/api/experiments').then(function(r){return r.json();}).then(function(d){
      if(d && d.configured===false){ document.getElementById('annexMsg').innerHTML='<div class="error-box">Not connected to the live sheet yet (GOOGLE_SA_KEY / INVENTORY_SHEET_ID). Scheduling will work once those are set.</div>'; }
      else { document.getElementById('annexMsg').innerHTML=''; }
      data=(d&&d.experiments||[]).filter(function(x){return x.status!=='cancelled';});
      renderList(); renderPast(); renderCal();
    }).catch(function(){ document.getElementById('ax_list').innerHTML='<div class="error-box">Couldn\u2019t load experiments.</div>'; });
  }

  function submitExperiment(){
    var name=(document.getElementById('ax_name').value||'').trim();
    var sd=(document.getElementById('ax_sd').value||'').trim();
    if(!name){ return toast('Experiment name is required', true); }
    if(!sd){ return toast('Start date is required', true); }
    var ed=(document.getElementById('ax_ed').value||'').trim();
    if(ed && ed<sd){ return toast('End date is before start date', true); }
    var isEdit=!!editing;
    var btn=document.getElementById('ax_add'); btn.disabled=true; btn.textContent=isEdit?'Saving…':'Adding…';
    var body={ action:isEdit?'update':'add', entryId:editing||'', experimentId:(document.getElementById('ax_id').value||'').trim(), name:name,
      project:(document.getElementById('ax_proj').value||'').trim(), operators:(document.getElementById('ax_ops').value||'').trim(),
      purpose:(document.getElementById('ax_purpose').value||'').trim(), startDate:sd, endDate:ed,
      startTime:(document.getElementById('ax_st').value||'').trim(), endTime:(document.getElementById('ax_et').value||'').trim(),
      biohub:document.getElementById('ax_biohub').checked, wholeSpace:document.getElementById('ax_whole').checked, by:who() };
    fetch('/api/experiments', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) })
      .then(function(r){return r.json();}).then(function(d){
        btn.disabled=false;
        if(d&&d.ok){ toast(isEdit?'Experiment updated':'Experiment scheduled'); setAddMode(); clearForm(); load(); }
        else { btn.textContent=isEdit?'Save changes':'Add experiment'; toast('Error: '+((d&&d.error)||'could not save'), true); }
      }).catch(function(){ btn.disabled=false; btn.textContent=isEdit?'Save changes':'Add experiment'; toast('Network error', true); });
  }
  function startEdit(x){
    if(!x) return;
    editing=x.entryId;
    var set=function(id,val){ var e=document.getElementById(id); if(e) e.value=val||''; };
    set('ax_id',x.experimentId); set('ax_name',x.name); set('ax_proj',x.project); set('ax_ops',x.operators);
    set('ax_purpose',x.purpose); set('ax_sd',x.startDate); set('ax_ed',(x.endDate&&x.endDate!==x.startDate)?x.endDate:''); 
    set('ax_st',x.startTime); set('ax_et',x.endTime);
    document.getElementById('ax_biohub').checked=!!x.biohub; document.getElementById('ax_whole').checked=!!x.wholeSpace;
    document.getElementById('ax_add').textContent='Save changes';
    document.getElementById('ax_canceledit').style.display='';
    var ft=document.getElementById('ax_formtitle'); if(ft) ft.textContent='Edit experiment · '+(x.name||x.experimentId||'');
    var fw=document.getElementById('expFormWrap'); if(fw){ fw.open=true; fw.scrollIntoView({block:'start'}); }
  }
  function cancelEdit(){ setAddMode(); clearForm(); }
  function setAddMode(){
    editing=null;
    document.getElementById('ax_add').textContent='Add experiment';
    var ce=document.getElementById('ax_canceledit'); if(ce) ce.style.display='none';
    var ft=document.getElementById('ax_formtitle'); if(ft) ft.textContent='＋ Schedule an experiment';
  }
  function clearForm(){
    ['ax_id','ax_name','ax_proj','ax_ops','ax_purpose','ax_ed','ax_st','ax_et'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
    document.getElementById('ax_biohub').checked=false; document.getElementById('ax_whole').checked=false;
    var sd=document.getElementById('ax_sd'); if(sd) sd.value=todayISO();
  }

  function renderList(){
    var host=document.getElementById('ax_list'); var today=todayISO();
    var list=data.filter(function(x){ return (x.endDate||x.startDate) >= today; });
    var sub=document.getElementById('ax_listsub');
    if(filterDay){
      list=data.filter(function(x){ return coversDay(x, filterDay); });
      if(sub) sub.innerHTML='Showing '+esc(filterDay)+' · <span class="rsv-link" id="ax_clearday">show all upcoming</span>';
    } else { if(sub) sub.textContent='Soonest first.'; }
    list.sort(function(a,b){ return (a.startDate+(a.startTime||'')).localeCompare(b.startDate+(b.startTime||'')); });
    if(!list.length){ host.innerHTML='<div class="empty">'+(filterDay?'No experiments on this day.':'No upcoming experiments scheduled.')+'</div>'; wireClearDay(); return; }
    host.innerHTML=list.map(function(x){ return expCard(x, true); }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('[data-cancel]'),function(b){
      b.onclick=function(){ cancelExp(b.getAttribute('data-cancel')); };
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-edit]'),function(b){
      b.onclick=function(){ var id=b.getAttribute('data-edit'); var x=data.filter(function(e){return e.entryId===id;})[0]; startEdit(x); };
    });
    wireClearDay();
  }
  // shared experiment card; withCancel adds the Cancel action (upcoming only)
  function expCard(x, withCancel){
    return '<div class="ax-card'+(x.wholeSpace?' whole':'')+'">'+
      '<div class="ax-main">'+
        '<div class="ax-title">'+esc(x.name||x.experimentId||'(untitled)')+
          (x.experimentId&&x.name?'<span class="key">'+esc(x.experimentId)+'</span>':'')+
          (x.wholeSpace?'<span class="flag out">whole space</span>':'')+
          (x.biohub?'<span class="flag lock">Biohub</span>':'')+'</div>'+
        '<div class="ax-when">'+esc(fmtRange(x))+'</div>'+
        '<div class="ax-meta">'+[x.project?('Project: '+esc(x.project)):'', x.operators?('Operators: '+esc(x.operators)):'', x.purpose?esc(x.purpose):''].filter(Boolean).join(' · ')+'</div>'+
      '</div>'+
      (withCancel?'<div class="ax-actions"><button class="btn btn-sm" data-edit="'+esc(x.entryId)+'">Edit</button>'+
        '<button class="btn btn-sm btn-danger" data-cancel="'+esc(x.entryId)+'">Cancel</button></div>':'')+
    '</div>';
  }
  function renderPast(){
    var host=document.getElementById('ax_pastlist'); if(!host) return; var today=todayISO();
    var past=data.filter(function(x){ return (x.endDate||x.startDate) < today; });
    past.sort(function(a,b){ return (b.startDate+(b.startTime||'')).localeCompare(a.startDate+(a.startTime||'')); }); // most recent first
    var cnt=document.getElementById('ax_pastcount'); if(cnt) cnt.textContent=past.length?(past.length+''):'';
    host.innerHTML = past.length ? past.map(function(x){ return expCard(x, false); }).join('') : '<div class="empty">No past experiments yet.</div>';
  }
  function wireClearDay(){ var c=document.getElementById('ax_clearday'); if(c) c.onclick=function(){ filterDay=null; renderList(); renderCal(); }; }

  function cancelExp(entryId){
    if(!entryId) return;
    App.drawer ? App.drawer('Cancel experiment', '<p style="margin:0 0 16px">Remove this experiment from the Annex schedule?</p><div class="row-actions"><button class="btn" id="ax_no">Back</button><button class="btn btn-danger" id="ax_yes">Cancel it</button></div>') : doCancel(entryId);
    if(App.drawer){
      document.getElementById('ax_no').onclick=function(){ App.closeDrawer(); };
      document.getElementById('ax_yes').onclick=function(){ App.closeDrawer(); doCancel(entryId); };
    }
  }
  function doCancel(entryId){
    fetch('/api/experiments', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({action:'cancel', entryId:entryId}) })
      .then(function(r){return r.json();}).then(function(d){ if(d&&d.ok){ toast('Experiment cancelled'); load(); } else { toast('Error: '+((d&&d.error)||'could not cancel'), true); } });
  }

  function renderCal(){
    var host=document.getElementById('ax_cal'); if(!host) return;
    var y=calMonth.getFullYear(), m=calMonth.getMonth();
    var monthName=calMonth.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    var first=new Date(y,m,1); var startDow=first.getDay();
    var gridStart=new Date(y,m,1-startDow);
    var cells='';
    var dow=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(function(d){return '<div class="cal-dow">'+d+'</div>';}).join('');
    for(var i=0;i<42;i++){
      var dt=new Date(gridStart.getFullYear(),gridStart.getMonth(),gridStart.getDate()+i);
      var iso=isoOf(dt); var inMonth=dt.getMonth()===m;
      var dayExps=data.filter(function(x){return coversDay(x,iso);});
      var whole=dayExps.some(function(x){return x.wholeSpace;});
      var cls='cal-cell'+(inMonth?'':' out')+(iso===todayISO()?' today':'')+(iso===filterDay?' sel':'');
      var mark = dayExps.length ? '<span class="cal-dot'+(whole?' whole':'')+'">'+(dayExps.length>1?dayExps.length:'')+'</span>' : '';
      cells+='<button class="'+cls+'" data-day="'+iso+'"'+(dayExps.length?'':' disabled')+'><span class="cal-num">'+dt.getDate()+'</span>'+mark+'</button>';
    }
    host.innerHTML='<div class="cal-head"><button class="btn btn-sm" id="cal_prev">‹</button><div class="cal-title">'+esc(monthName)+'</div><button class="btn btn-sm" id="cal_next">›</button></div>'+
      '<div class="cal-grid">'+dow+cells+'</div>';
    document.getElementById('cal_prev').onclick=function(){ calMonth=new Date(y,m-1,1); renderCal(); };
    document.getElementById('cal_next').onclick=function(){ calMonth=new Date(y,m+1,1); renderCal(); };
    Array.prototype.forEach.call(host.querySelectorAll('[data-day]'),function(b){
      b.onclick=function(){ var iso=b.getAttribute('data-day'); filterDay=(filterDay===iso?null:iso); renderList(); renderCal(); document.getElementById('ax_list').scrollIntoView({block:'start'}); };
    });
  }

  return { mount:mount };
})();
