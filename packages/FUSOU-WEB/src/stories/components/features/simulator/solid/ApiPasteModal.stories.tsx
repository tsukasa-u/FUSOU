/** @jsxImportSource solid-js */
import { StorybookModalPreview } from "../../../../storybook-fixtures";
import {
  ApiPasteModal,
  apiPasteModalRef,
} from "../../../../../components/features/simulator/solid/ApiPasteModal";

function ApiPasteModalPreview() {
  return (
    <StorybookModalPreview dialog={() => apiPasteModalRef.current}>
      <ApiPasteModal />
    </StorybookModalPreview>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/ApiPasteModal",
  component: ApiPasteModal,
  tags: ["autodocs"],
};

export const Default = {
  render: () => <ApiPasteModalPreview />,
};
