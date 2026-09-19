import { useEffect } from "react";
import { getMentors, getMyApplications, getOpportunities } from "../services/opportunitiesService";

function useOpportunities({ authUser, campusId, setDbMentors, setDbOpportunities, setMyApplicationIds }) {
  useEffect(() => {
        let mounted = true;
  
        Promise.all([getOpportunities(campusId), getMentors(campusId)])
          .then(([opps, mentorList]) => {
            if (!mounted) return;
            setDbOpportunities(opps);
            setDbMentors(mentorList);
          })
          .catch((error) => console.error("Opportunities/mentors loading error:", error));
  
        return () => { mounted = false; };
      }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps -- the setX are useState setters, stable

  useEffect(() => {
        if (!authUser?.id) { setMyApplicationIds([]); return; }
        getMyApplications(authUser.id)
          .then((apps) => setMyApplicationIds(apps.map((a) => a.opportunity_id)))
          .catch(() => {});
      }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- setMyApplicationIds is a useState setter, stable
}

export { useOpportunities };
