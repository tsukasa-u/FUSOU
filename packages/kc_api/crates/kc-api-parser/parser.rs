use register_trait::expand_struct_selector;
use register_trait::TraitForConvert;

use kc_api_interface::interface::EmitData;

use std::error::Error;

#[expand_struct_selector(path = "../kc-api-dto/src/main", root_crate = true)]
pub fn response_parser(name: String, data: String) -> Result<Vec<EmitData>, Box<dyn Error>> {
    let root_wrap: Result<kcsapi_lib::Res, serde_json::Error> = serde_json::from_str(&data);

    match root_wrap {
        Ok(root) => match root.convert() {
            Some(emit_data_list) => {
                return Ok(emit_data_list);
            }
            None => {
                return Ok(Vec::new());
            }
        },
        Err(e) => {
            tracing::error!("Failed to parse Res JSON({:?}): {}", name, e);
            return Err(Box::new(e));
        }
    };
}

#[expand_struct_selector(path = "../kc-api-dto/src/main", root_crate = true)]
pub fn request_parser(name: String, data: String) -> Result<Vec<EmitData>, Box<dyn Error>> {
    let root_wrap: Result<kcsapi_lib::Req, serde_qs::Error> = serde_qs::from_str(&data);

    match root_wrap {
        Ok(root) => match root.convert() {
            Some(emit_data_list) => {
                return Ok(emit_data_list);
            }
            None => {
                return Ok(Vec::new());
            }
        },
        Err(e) => {
            tracing::error!("Failed to parse Req JSON({:?}): {}", name, e);
            return Err(Box::new(e));
        }
    };
}
