import { ComponentColorBarProps, ComponentColorBar } from "ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";



const size_list = ["none", "xs", "sm", "md", "lg", "xl"];

const ComponentColorBarBasic = (args: ComponentColorBarProps) => {
  return (<ComponentColorBar
    v_now={args.v_now}
    v_max={args.v_max}
    size={args.size}
    quantize={args.quantize}
  ></ComponentColorBar>);
};

const ComponentColorBarCatalog = () => {
  const value_map = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  return (<div class="grid gap-4">
    {value_map.map(
      (v_now) =>
        (<div class="grid">
          <div class="flex">
            <div class="w-30">${v_now}%</div>
            <ComponentColorBar
              class="w-full"
              v_now={v_now}
              v_max={100}
              size={"xs"}
            ></ComponentColorBar>
          </div>
          <div class="flex">
            <div class="w-30">5-quantized</div>
            <ComponentColorBar
              class="w-full"
              v_now={v_now}
              v_max={100}
              size={"xs"}
              quantize={5}
            ></ComponentColorBar>
          </div>
        </div>)
    )}
  </div>
  );
};

const meta = {
  title: "FUSOU/components/bar/component-color-bar",
  tags: ["autodocs"],
} satisfies Meta<ComponentColorBarProps>;

export default meta;
type Story = StoryObj<ComponentColorBarProps>;

export const basic: Story = {
  render: (args: ComponentColorBarProps) => ComponentColorBarBasic(args),
  name: "Basic",
  argTypes: {
    v_now: {
      control: { type: "range", max: 100, min: 0 },
    },
    v_max: {
      control: { disable: true },
    },
    quantize: {
      control: { type: "range", max: 10, min: 0 },
      table: {
        defaultValue: { summary: "undefined" },
        type: {
          summary: ["undefined", "number"].join("|"),
        },
      },
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
    v_now: 70,
    v_max: 100,
    quantize: undefined,
    size: "xs",
  },
};

export const catalog: Story = {
  render: () => ComponentColorBarCatalog(),
  name: "Catalog",
  argTypes: {
    v_now: {
      control: { disable: true },
    },
    v_max: {
      control: { disable: true },
    },
    quantize: {
      control: { disable: true },
    },
    size: {
      control: { disable: true },
    },
  },
};
