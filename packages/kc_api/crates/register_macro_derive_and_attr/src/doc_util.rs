use std::fs;
use std::io::Read;
use std::path;

use proc_macro::TokenStream;
use regex::Regex;

use darling::ast::NestedMeta;
use darling::FromMeta;

#[derive(Debug, FromMeta)]
pub struct MacroArgsInsertSVG {
    #[darling(default)]
    path: path::PathBuf,
    id: Option<String>,
    style: Option<String>,
    role: Option<String>,
    aria_label: Option<String>,
    path_panic: Option<bool>,
}

pub fn insert_svg(attr: TokenStream) -> Result<TokenStream, syn::Error> {
    let attr_args = match NestedMeta::parse_meta_list(attr.into()) {
        Ok(v) => v,
        Err(e) => {
            return Err(e);
        }
    };

    let args = match MacroArgsInsertSVG::from_list(&attr_args) {
        Ok(v) => v,
        Err(e) => {
            return Err(e.into());
        }
    };

    if !fs::exists(args.path.clone()).expect("Can not check existence of file") {
        if args.path_panic.unwrap_or(false) {
            return Err(syn::Error::new_spanned(
                format!("path=\"{}\"", args.path.clone().to_str().unwrap_or("???")),
                "the file is not exist",
            ));
        } else {
            let error_msg = "failed to load svg file";
            return match format!("r##\"{error_msg}\"##").parse() {
                Ok(s) => Ok(s),
                Err(e) => Err(syn::Error::new_spanned(e.to_string(), "faild to parse")),
            };
        }
    }

    let mut f = fs::File::open(args.path).expect("file not found");

    let mut contents = String::new();
    f.read_to_string(&mut contents)
        .expect("something went wrong reading the file");

    let re_xml = Regex::new(r"<\?xml[^<>]+\?>").unwrap();
    let re_doctype = Regex::new(r"<!DOCTYPE[^<>]+>").unwrap();
    let re_comment = Regex::new(r"<!--[^<>!-]+-->").unwrap();
    let re_endline = Regex::new(r"\r?\n").unwrap();
    // <?xml version="1.0" encoding="UTF-8" standalone="no"?>
    // <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"
    // "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">

    let contents_remove_xml = re_xml.replace(&contents, "");
    let contents_remove_doctype = re_doctype.replace(&contents_remove_xml, "");
    let contents_remove_commnets = re_comment.replace_all(&contents_remove_doctype, "");
    let contents_remove_endline = re_endline.replace_all(&contents_remove_commnets, "");

    let re_svg = Regex::new(r"<\s*svg").unwrap();

    let contents_add_id = match args.id {
        Some(id) => {
            let contents_add_id =
                re_svg.replace(&contents_remove_endline, format!("<svg id=\"{id}\""));
            contents_add_id
        }
        None => contents_remove_endline,
    };

    let contents_add_style = match args.style {
        Some(style) => {
            let contents_add_style =
                re_svg.replace(&contents_add_id, format!("<svg style=\"{style}\""));
            contents_add_style
        }
        None => contents_add_id,
    };

    let contents_add_role = match args.role {
        Some(role) => {
            let contents_add_role =
                re_svg.replace(&contents_add_style, format!("<svg srole=\"{role}\""));
            contents_add_role
        }
        None => contents_add_style,
    };

    let contents_add_label = match args.aria_label {
        Some(label) => {
            let contents_add_label =
                re_svg.replace(&contents_add_role, format!("<svg aria-label=\"{label}\""));
            contents_add_label
        }
        None => contents_add_role,
    };

    let contents_formated = format!("r##\"{contents_add_label}\"##");

    match contents_formated.parse() {
        Ok(s) => Ok(s),
        Err(e) => Err(syn::Error::new_spanned(e.to_string(), "failed to parse")),
    }
}
