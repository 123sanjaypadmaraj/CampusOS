import { useEffect } from "react";
import { getLostFoundItems, getMarketplaceListings, getPeople, getResources, subscribeToLostFound, subscribeToMarketplace } from "../services/mvpService";

function useCampusDirectory({ campusId, setLostItems, setLostItemsLoaded, setMarketListings, setPeople, setResources }) {
  useEffect(() => {
        if (!campusId) return;
  
        const loadCampusData = () => {
          getPeople({ campusId }).then(setPeople).catch((error) => console.error("People loading failed", error));
          getResources(campusId).then(setResources).catch((error) => console.error("Resource loading failed", error));
          getLostFoundItems(campusId).then(setLostItems).catch((error) => console.error("Lost & found loading failed", error)).finally(() => setLostItemsLoaded(true));
          getMarketplaceListings(campusId).then(setMarketListings).catch((error) => console.error("Marketplace loading failed", error));
        };
  
        loadCampusData();
  
        const unsubMarket = subscribeToMarketplace(() => {
          getMarketplaceListings(campusId).then(setMarketListings).catch(() => {});
        });
  
        const unsubLost = subscribeToLostFound(() => {
          getLostFoundItems(campusId).then(setLostItems).catch(() => {});
        });
  
        return () => {
          unsubMarket?.();
          unsubLost?.();
        };
      }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps -- the setX are useState setters, stable
}

export { useCampusDirectory };
