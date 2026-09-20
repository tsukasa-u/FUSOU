# Third-Party Licenses for fusou-datasets

This document lists the open-source third-party dependencies used by `fusou-datasets` and verifies their compatibility with the **MIT License**.

---

## 1. Runtime Dependencies

| Package | Version Range | License | Compatibility with MIT | Usage Pattern |
| :--- | :--- | :--- | :--- | :--- |
| **requests** | `>=2.25.0, <3.0.0` | **Apache-2.0** | Compatible (Permissive) | HTTP API communication |
| **pandas** | `>=1.3.0, <3.0.0` | **BSD 3-Clause** | Compatible (Permissive) | Data manipulation and analysis |
| **fastavro** | `>=1.4.0, <2.0.0` | **MIT** | Fully Compatible | Parsing binary Avro OCF payloads |
| **pyarrow** | `>=10.0.0, <19.0.0` | **Apache-2.0** | Compatible (Permissive) | Parquet caching & zero-copy data exchange |
| **tqdm** | `>=4.60.0, <5.0.0` | **MPL-2.0 AND MIT** | Compatible (Library import) | Terminal progress bar display |

---

## 2. Development & Testing Dependencies

| Package | Version Range | License | Notes |
| :--- | :--- | :--- | :--- |
| **pytest** | `>=7.0.0` | **MIT** | Unit and integration testing |
| **pytest-cov** | `>=4.0.0` | **MIT** | Test coverage reporting |
| **pytest-mock** | `>=3.10.0` | **MIT** | Mocking HTTP and filesystem calls |

---

## 3. License Compatibility Verification Details

### Apache-2.0 (`requests`, `pyarrow`)
- The Apache License 2.0 is a permissive license that allows redistribution, modification, and sublicensing.
- Including Apache-2.0 dependencies as library imports in an MIT-licensed project is standard practice and fully compliant.

### BSD 3-Clause (`pandas`)
- The BSD 3-Clause License is a permissive license requiring attribution and copyright retention in source/binary distributions.
- Fully compatible with MIT.

### MPL-2.0 AND MIT Dual (`tqdm`)
- `tqdm` is dual-licensed under the Mozilla Public License 2.0 and the MIT License.
- Under MPL-2.0 Section 3.3, using `tqdm` as an unmodified library import does not require the importing codebase to be licensed under MPL. Furthermore, its dual-license includes MIT.

---

## 4. Conclusion

All runtime dependencies of `fusou-datasets` use permissive open-source licenses. **The MIT License of `fusou-datasets` can be maintained without any licensing conflicts or library replacements.**