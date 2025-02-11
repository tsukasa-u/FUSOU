import { createEffect } from "solid-js";
import { location_route } from "../utility/location";

function NotFound() {
  
    createEffect(location_route);
  
    return (
      <>
        <h1>Not Found</h1>
      </>
    );
  }
  
  export default NotFound;