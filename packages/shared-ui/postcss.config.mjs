import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import postcssPrefixSelector from "postcss-prefix-selector";

function transformSelector(prefix, selector, prefixedSelector) {
  if ([":root", ":host", "html", "body"].includes(selector)) {
    return ":host";
  }
  if (
    ["[data-theme]", "[data-theme=light]", "[data-theme=dark]"].includes(
      selector
    )
  ) {
    return `:host ${selector}`;
  }
  return prefixedSelector;
}

const postcssConfig = {
  plugins: [
    // Apply Tailwind CSS
    tailwindcss(),

    // Add a prefix to all selectors
    postcssPrefixSelector({
      prefix: "#my-ext",
      transform: transformSelector,
    }),

    // Add vendor prefixes
    autoprefixer(),
  ],
};

export default postcssConfig;
