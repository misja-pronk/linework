# Official icons

Cartography draws its own line icons (Lucide, ISC licence) on every shape. Customers often expect the vendors'
own stencils: the Azure, AWS, Google Cloud and Kubernetes icons they know from the vendor's documentation. Those
icons belong to the vendors, and their terms do not let us ship them. So you download each set once, Cartography
indexes it on your machine (or in your browser), and a diagram can use it with one line:

```yaml
type: azure
icons: official
```

## 1. Download a set

| Vendor | Where | What to click | What you get |
| --- | --- | --- | --- |
| Microsoft Azure | <https://learn.microsoft.com/azure/architecture/icons/> | **Download SVG icons** (after the icon terms) | `Azure_Public_Service_Icons_V23.zip` (V and the release number); inside, `Azure_Public_Service_Icons/Icons/<category>/<number>-icon-service-<Name>.svg` |
| Amazon Web Services | <https://aws.amazon.com/architecture/icons/> | **Download the asset package** (Architecture Icons) | `Asset-Package_07312025.zip` (the release date); inside, `Architecture-Service-Icons_<date>/Arch_<Category>/64/Arch_<Name>_64.svg` and `Resource-Icons_<date>/Res_<Category>/Res_<Name>_48.svg` |
| Google Cloud | <https://cloud.google.com/icons> | **Download all icons** (or the core products set) | `google-cloud-icons.zip`, a folder per product (`bigquery/bigquery.svg`); the core products set names files `<Product>-512-color.svg` |
| Kubernetes | <https://github.com/kubernetes/community/tree/master/icons> | **Code → Download ZIP** (or copy the `icons` folder) | `community-master.zip`; inside, `icons/svg/resources/unlabeled/<abbreviation>.svg` (`deploy.svg`, `sts.svg`, `svc.svg`) |

Vendors move these pages and rename their downloads now and then; if a link is dead, search for "Azure
architecture icons", "AWS architecture icons", "Google Cloud icons" or "Kubernetes community icons". The importer
does not depend on folder names or release numbers: it goes by the names of the icons themselves.
`carto icons` prints this table in the terminal, with what you have imported already.

## 2. Import it

**In the editor**: theme menu (top bar) → **Official icons…**. Drop the zip on the sheet, or use **Choose zip…** /
**Folder…** of the vendor. The icons are copied into the browser's private storage for this site (they survive a
reload and never leave the browser), and the sheet shows every shape of that vendor's diagram types with the icon
it got, how many have one, and which do not.

**In the terminal**:

```sh
carto icons import ~/Downloads/Azure_Public_Service_Icons_V23.zip      # the vendor is told from the files
carto icons import ~/Downloads/Asset-Package_07312025 --pack aws        # or say it
carto icons list                                                        # what is imported, and coverage
carto icons show azure -o azure.png                                     # a contact sheet: each shape and its icon
```

The CLI keeps sets in your config folder: `~/.config/cartography/icons/<pack>` (`$XDG_CONFIG_HOME`, `%APPDATA%`
on Windows, `CARTO_CONFIG_DIR` to put it elsewhere). Importing a newer release replaces the set and keeps what you
mapped by hand.

## 3. Check and fix the matching

Each vendor has a table from our shapes to the vendor's service names (`packages/icons/src/names.ts`):
`key-vault` → "Key Vaults", `lambda` → "Lambda", `deployment` → `deploy`. Matching goes by the words of the file
name, so `10245-icon-service-Key-Vaults.svg` in one release and `10251-icon-service-Key-Vaults.svg` in the next are
the same icon, and size suffixes (`_64`, `_48`), category prefixes (`Arch_`, `Res_`) and `labeled` / `unlabeled`
folders are understood (the 64 px service icon and the unlabeled Kubernetes icon win). A shape without a confident
match keeps its line icon: no icon is better than the wrong one.

To give a shape another icon, or one it did not get:

- **Editor**: in the sheet, click the shape, type words of the icon's name, click the icon. **No official icon for …**
  undoes it.
- **Terminal**:

  ```sh
  carto icons find azure search                 # icons of the set by name
  carto icons map azure ai-search search        # by words of the name, or a file path in the set
  carto icons unmap azure ai-search             # back to the line icon
  ```

Hand mappings are stored in the set's own record (`pack.json` under `manual`; in the browser, next to the set) and
are carried over when you import a newer release: a file that was renumbered is found again by its name.

## 4. Use it

| Where | How |
| --- | --- |
| A diagram | `icons: official` uses the imported sets of its type: Azure for `type: azure`, AWS and Google Cloud for `type: cloud` (each shape its own vendor's; people, servers and other shapes every vendor has take the first set: AWS), Kubernetes for `type: kubernetes`. `icons: lucide` keeps our line icons. Without `icons:` a diagram draws line icons, so it looks the same on every machine. |
| The editor | Theme menu → **Icons as the diagram says** / **Official icons** / **Line icons**. Like the theme picker, the choice wins over the diagram and applies to the canvas, presenting and every export. |
| The CLI | `--icons official` or `--icons lucide` on `render`, `deck` and `watch` wins over the diagram's `icons:`. |
| By hand in a diagram | `icons: { pack: azure, front-door: ./icons/afd.svg }`: a named set (CLI) plus single SVG files next to the diagram; or `icons: ./azure.icons.yaml`, a pack file in a private repository (`name`, `root`, `icons: { kind: file }`). |

When a diagram asks for a set that is not imported, it still draws, with line icons and a warning that says how
to import it.

### In each look

Official icons are drawn as they are, never recoloured or cropped. On a light page with bare icons (Survey,
Sketch) they sit straight on the card at 28 px; in looks with icon tiles, and on every dark page, they sit on a
neutral light tile (never the shape's tone, which would clash with the vendor's colours) so dark parts of an icon
stay visible. Labels, captions and lines keep the look's own colours and contrast.

### Exports

| Export | Official icons |
| --- | --- |
| SVG, PNG, PDF | Each icon once per kind, embedded as a `data:image/svg+xml;base64` image. A vendor icon is 2–10 kB, a third more as base64: a diagram with 15 different services grows by about 50–150 kB. |
| Office-safe SVG (`--svg-safe`) | The same images; PowerPoint, Word and Keynote show them. |
| PowerPoint | Each icon a picture on the slide (SVG, with a PNG fallback from the CLI), shared by all slides. |
| Share links | Not included: a share link carries only the YAML. Whoever opens it sees line icons unless they imported the set too. |

## What may be shared

The vendors' terms are theirs; read the current text when you download. In short, at the time of writing:

- **Microsoft Azure**: for architecture diagrams, training material and documentation. Do not modify, crop or
  recolour the icons, and do not redistribute the set.
- **AWS**: for architecture diagrams, unmodified, without implying AWS endorses you; follow AWS's trademark
  guidelines.
- **Google Cloud**: for diagrams of Google Cloud architectures, under the terms on the download page; do not change
  the icons.
- **Kubernetes**: CC BY 4.0, by the Kubernetes authors; credit "Kubernetes icons, CC BY 4.0" where you publish.

What that means for Cartography:

| You can | You cannot |
| --- | --- |
| Send a customer the PNG, PDF, SVG or deck of a diagram drawn with official icons | Commit the downloaded set (or a folder of its SVGs) to a public repository |
| Publish an interactive HTML page (it carries only the icons the diagram uses, as drawn) | Bundle the set with a tool, a template pack or an npm package |
| Keep a pack file (`*.icons.yaml`) and the set in your company's private repository, for your team | Recolour or edit the icons to match a theme (Cartography never does) |

Cartography itself never ships, downloads or changes vendor icons, and nothing of an imported set is ever part
of the repository, the npm packages, a diagram file or a share link. Its own assets stay Lucide (ISC) and the
bundled fonts (SIL OFL 1.1).
