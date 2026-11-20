import TutorialModal from "../../../../../components/common/astro/ui/TutorialModal.astro";

export default {
  title: "Components/common/astro/ui/TutorialModal",
  component: TutorialModal,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "inlinePreview": true,
    "guide": {
      "id": "storybook-preview",
      "title": "操作説明",
      "summary": "Storybook のページプレビューです。",
      "steps": [
        "ページ上の操作を確認します。"
      ],
      "openOnFirstVisit": false
    }
  },
};
