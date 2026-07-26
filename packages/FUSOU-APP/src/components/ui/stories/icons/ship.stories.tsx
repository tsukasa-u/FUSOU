import { IconShipProps, IconShip } from "ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";



import get_data from "@fusou-testdata-shared-ui/data/S@api_start2@getData.json";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const IconShipBasic = (args: IconShipProps) => {
  return (<IconShip
    ship_stype={args.ship_stype}
    color={args.color}
    size={args.size}
    empty_flag={args.empty_flag}
  ></IconShip>);
};

const IconShipCatalog = () => {
  //   console.log(get_data.api_data.api_mst_ship);
  const category_type_number = [
    ...new Set(
      get_data.api_data.api_mst_ship.map((x) =>
        String([x.api_stype, x.apt_ctype])
      )
    ),
  ].map((s) => s.split(",").map((x) => Number(x)));

  return (<div class="grid grid-cols-6 w-100 gap-4">
    {category_type_number.map(
      ([stype, _ctype]) =>
        (<div class="grid gap-4">
        <IconShip ship_stype={stype} color={""} size={"xs"} />
          <IconShip
            ship_stype={stype}
            color={"elite"}
            size={"xs"}
          ></IconShip>
          <IconShip
            ship_stype={stype}
            color={"flagship"}
            size={"xs"}
          ></IconShip>
        </div>)
    )}
  </div>
  );
};

const meta = {
  title: "FUSOU/icons/icon-ship",
  tags: ["autodocs"],
} satisfies Meta<IconShipProps>;

export default meta;
type Story = StoryObj<IconShipProps>;

export const basic: Story = {
  render: (args: IconShipProps) => IconShipBasic(args),
  name: "Basic",
  argTypes: {
    ship_stype: {
      control: { type: "select" },
      options: [1, 2, 3, 4, 5],
    },
    color: {
      control: { type: "select" },
      options: [undefined, "", "-", "elite", "flagship"],
    },
    empty_flag: {
      control: "boolean",
    },
    size: {
      control: { type: "select" },
      options: size_list,
      table: {
        defaultValue: { summary: "xs" },
        type: {
          summary: size_list.join("|"),
        },
      },
    },
  },
  args: {
    size: "full",
    ship_stype: 1,
    color: "",
    empty_flag: false,
  },
};

export const catalog: Story = {
  render: () => IconShipCatalog(),
  name: "Catalog",
  argTypes: {
    ship_stype: {
      control: { disable: true },
    },
    color: {
      control: { disable: true },
    },
    size: {
      control: { disable: true },
    },
  },
};
