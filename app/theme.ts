import { createTheme, type MantineColorsTuple } from "@mantine/core";

// プライマリは #1E4F86（index 6）。それ以外の色は使わない
const navy: MantineColorsTuple = [
  "#EEF3F9", "#D7E2EF", "#ADC3DE", "#7FA1CC", "#5683B9", "#336AA4", "#1E4F86", "#173F6C", "#112F52", "#0A1F38",
];

export const theme = createTheme({
  primaryColor: "navy",
  primaryShade: 6,
  colors: { navy },
  black: "#1A1A1A",
  fontFamily: '"Noto Sans JP", system-ui, sans-serif',
  fontFamilyMonospace: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  headings: { fontFamily: '"Noto Sans JP", system-ui, sans-serif', fontWeight: "500" },
  defaultRadius: "sm",
  radius: { xs: "3px", sm: "5px", md: "6px", lg: "6px", xl: "6px" },
  shadows: { xs: "none", sm: "none", md: "none", lg: "none", xl: "none" },
  fontSizes: { xs: "11.5px", sm: "12.5px", md: "13.5px", lg: "15px", xl: "18px" },
  focusRing: "auto",
  components: {
    Button: { defaultProps: { radius: "sm", fw: 500 } },
    Drawer: { defaultProps: { shadow: "none" } },
  },
});
