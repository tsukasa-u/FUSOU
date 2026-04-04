import { createEffect } from "solid-js";
import { location_route } from "../utility/location";
import { PolicyPanelComponent } from "../components/policy/policy_panel";

function Policy() {
  createEffect(location_route);

  return <PolicyPanelComponent showBackLink={true} />;
}

export default Policy;
