import { CustomTitlebar } from "../components/ui/titlebar";
import { WindowResizeBorders } from "../components/ui/window_resize_borders";

interface ChromePageProps {
  isMaximized: boolean;
}

export function ChromePage(props: ChromePageProps) {
  return (
    <div class="w-screen h-8 overflow-hidden relative bg-transparent">
      <WindowResizeBorders
        isMaximized={props.isMaximized}
        edges={{ top: true, bottom: false, left: true, right: true }}
      />
      <CustomTitlebar
        isMaximized={props.isMaximized}
        variant="combined-chrome"
      />
    </div>
  );
}

export default ChromePage;
