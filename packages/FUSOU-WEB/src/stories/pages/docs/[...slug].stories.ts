import Page from "../../../pages/docs/[...slug].astro";
import { pageState } from "../../storybook-page-state";

export default {
  title: "Pages/docs/Dynamic",
  component: Page,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = {
  args: {
    "slug": "start/what_is_fusou"
  },
  parameters: pageState(),
};

function articleStory(slug: string) {
  return {
    args: { slug },
    parameters: pageState(),
  };
}

export const QuickStart = articleStory("start/quick_start");
export const Install = articleStory("start/install");
export const WebkitDowngrade = articleStory("guide/webkit_downgrade");
export const SetHttps = articleStory("guide/set_https");
export const ManualSync = articleStory("guide/manual_sync");
export const AssetSync = articleStory("guide/asset_sync");
export const ApiOverview = articleStory("guide/api_overview");
export const CliFlags = articleStory("guide/cli_flags");
export const DashboardApiKeys = articleStory("guide/dashboard/api_keys");
export const DatasetExamples = articleStory("guide/fusou_datasets/examples");
export const DatasetAuthentication = articleStory("guide/fusou_datasets/authentication");
export const DatasetApiReference = articleStory("guide/fusou_datasets/api_reference");
export const DatasetInstallation = articleStory("guide/fusou_datasets/installation");
export const DatasetGettingStarted = articleStory("guide/fusou_datasets/getting_started");
export const DatasetQueryArchitecture = articleStory("guide/fusou_datasets/query_engine_architecture");
export const DatasetTroubleshooting = articleStory("guide/fusou_datasets/troubleshooting");
export const Terms = articleStory("policy/terms");
export const Privacy = articleStory("policy/privacy");
export const DatasetLicensePolicy = articleStory("policy/fusou_dataset_license_policy");
export const CopyrightQuotationPolicy = articleStory("policy/copyright_quotation_policy");
export const CommunicationIntegrityPolicy = articleStory("policy/communication_integrity_policy");
export const WebLicense = articleStory("license/fusou_web");
export const AppLicense = articleStory("license/fusou_app");
