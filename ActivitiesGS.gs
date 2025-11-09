<script>
/* === ARENA · Phase 5C — Real Candidate + Quick Actions Persistence === */
window.addEventListener('load', function(){
  if (!window.Arena){ console.warn('⚠️ Arena base not found'); return; }

  (function(A){

    /* ---- 1. Load real candidates when CallList selected ---- */
    A.loadCallListReal = function(callListId){
      google.script.run.withSuccessHandler(function(bundle){
        if(!bundle) return;
        A.state.job = bundle.job || {};
        A.state.company = bundle.company || {};
        const ids = bundle.job ? bundle.job.JobID : '';
        google.script.run.withSuccessHandler(function(cands){
          A.state.listCandidates = cands;
          if(cands && cands.length){
            A.state.index = 0;
            A.state.candidate = cands[0];
            A.renderCandidate(cands[0]);
            A.renderActions(cands[0], A.state.recruiter);
          }else{
            document.getElementById('arena-middle').innerHTML = '<div class="arena-card"><h3>Candidate Profile</h3><div>No candidates in this list.</div></div>';
          }
        }).getCandidatesForCallList(callListId);
      }).getJobAndCompanyForCallList(callListId);
    };

    /* ---- 2. Hook into existing CallList selector ---- */
    var sel = document.getElementById('arena-calllist');
    if(sel){
      sel.onchange = function(){
        var id = sel.value;
        if(id){ A.loadCallListReal(id); }
      };
    }

    /* ---- 3. Make Quick Actions save to Activities ---- */
    A.saveQuickAction = function(type, payload, callback){
      const ctx = {
        Type: type,
        RecruiterID: 'USR01',
        RecruiterName: 'Oriol',
        CandidateID: A.state.candidate ? A.state.candidate.CandidateID : '',
        JobID: A.state.job ? A.state.job.JobID : '',
        CallListID: A.state.callListID || '',
        CompanyID: A.state.company ? A.state.company.CompanyID : '',
        CompanyName: A.state.company ? A.state.company.CompanyName : '',
        Notes: payload.Notes || '',
        Result: payload.Result || '',
        Outcome: payload.Outcome || ''
      };
      google.script.run.withSuccessHandler(function(res){
        console.log('✅ Saved activity', res);
        if(callback) callback(res);
        A.refreshTimeline();
      }).saveActivity(ctx);
    };

    /* ---- 4. Refresh timeline ---- */
    A.refreshTimeline = function(){
      if(!A.state.candidate || !A.state.job) return;
      google.script.run.withSuccessHandler(function(list){
        var right=document.getElementById('arena-right');
        if(!right) return;
        if(!list||!list.length){
          right.querySelector('.timeline-wrap').innerHTML='<div class="a2-subtle">No activities yet.</div>';
          return;
        }
        var h='';
        for(var i=0;i<list.length;i++){
          var a=list[i];
          h+='<div class="timeline-item">'+
              '<span class="t-type">'+a.Type+'</span>'+
              '<span class="t-date">'+(a.CreatedOn||'')+'</span><br>'+
              '<b>'+a.Result+'</b> — '+(a.Outcome||'')+'<br>'+
              '<i>'+a.Notes+'</i></div>';
        }
        right.querySelector('.timeline-wrap').innerHTML=h;
      }).getActivitiesForContext(A.state.candidate.CandidateID, A.state.job.JobID);
    };

    console.log('✅ Arena · Phase 5C (Real Data + Persistence) loaded');
  })(window.Arena);
});
</script>
