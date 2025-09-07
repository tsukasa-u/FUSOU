export const fetch_font = (font_family: string) => {
  const urlFamilyName = font_family.replace(/ /g, "+");
  const googleApiUrl = `https://fonts.googleapis.com/css?family=${urlFamilyName}`;

  return fetch(googleApiUrl)
    .then((response) => {
      if (!response.ok) throw new Error("failed to fetch font");
      return response.text();
    })
    .then((css) => {
      const matchUrls = css.match(/url\(.+?\)/g);
      if (!matchUrls) throw new Error("failed to find font");

      const fontPromises = matchUrls.map((url) => {
        const font = new FontFace(font_family, url);
        return font.load().then(() => document.fonts.add(font));
      });

      return Promise.all(fontPromises);
    });
};
