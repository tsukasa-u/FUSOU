import { createEffect } from "solid-js";
import { location_route } from "../utility/location";

function Debug() {
  
    createEffect(location_route);
  
    return (
      <>
        <h1>For Debug</h1>
      </>
    );
  }
  
  export default Debug;