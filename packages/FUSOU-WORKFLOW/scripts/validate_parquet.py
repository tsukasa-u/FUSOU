"""
Parquet output file validation script (PyArrow version)

Required libraries:
  pip install pyarrow boto3

Environment variables:
  R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
  R2_ACCESS_KEY=<your-access-key>
  R2_SECRET_KEY=<your-secret-key>
  R2_BUCKET=dev-kc-battle-data
"""

import os
import sys
import pyarrow.parquet as pq
import boto3
from io import BytesIO

def setup_r2_client():
    """Initialize R2 client"""
    endpoint = os.getenv('R2_ENDPOINT')
    access_key = os.getenv('R2_ACCESS_KEY')
    secret_key = os.getenv('R2_SECRET_KEY')
    
    if not all([endpoint, access_key, secret_key]):
        raise ValueError("Missing R2 credentials in environment variables")
    
    return boto3.client(
        's3',
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name='auto'
    )

def validate_parquet_file(s3_client, bucket, key):
    """Validate Parquet file"""
    print(f"\n=== Validating: {key} ===")
    
    try:
        # Download from R2
        obj = s3_client.get_object(Bucket=bucket, Key=key)
        data = obj['Body'].read()
        
        # Load Parquet
        buffer = BytesIO(data)
        table = pq.read_table(buffer)
        metadata = pq.read_metadata(buffer)
        
        # Basic info
        print(f"✓ File size: {len(data):,} bytes")
        print(f"✓ Schema: {table.schema}")
        print(f"✓ Rows: {len(table):,}")
        print(f"✓ Columns: {table.num_columns}")
        print(f"✓ Row Groups: {metadata.num_row_groups}")
        
        # Row Group details
        print("\nRow Groups Detail:")
        total_rows = 0
        for i in range(metadata.num_row_groups):
            rg = metadata.row_group(i)
            total_rows += rg.num_rows
            print(f"  RG{i}: {rg.num_rows:,} rows, {rg.total_byte_size:,} bytes")
        
        # Integrity check
        if total_rows != len(table):
            print(f"✗ WARNING: Row count mismatch (RG total: {total_rows}, table: {len(table)})")
        else:
            print(f"✓ Row count consistent: {total_rows:,}")
        
        # Sample data
        print("\nSample data (first 5 rows):")
        print(table.to_pandas().head())
        
        return True
        
    except Exception as e:
        print(f"✗ ERROR: {e}")
        return False

def main():
    """Main processing"""
    if len(sys.argv) < 2:
        print("Usage: python validate_parquet.py <key1> [key2] [key3] ...")
        print("Example: python validate_parquet.py battle_compacted/2024Q4/dataset-123/battle/0.parquet")
        sys.exit(1)
    
    bucket = os.getenv('R2_BUCKET', 'dev-kc-battle-data')
    keys = sys.argv[1:]
    
    print(f"R2 Bucket: {bucket}")
    print(f"Files to validate: {len(keys)}")
    
    s3_client = setup_r2_client()
    
    results = []
    for key in keys:
        result = validate_parquet_file(s3_client, bucket, key)
        results.append((key, result))
    
    # Summary
    print("\n=== Validation Summary ===")
    success = sum(1 for _, r in results if r)
    print(f"Total: {len(results)}")
    print(f"Success: {success}")
    print(f"Failed: {len(results) - success}")
    
    if success == len(results):
        print("\n✓ All files are valid!")
        sys.exit(0)
    else:
        print("\n✗ Some files failed validation")
        sys.exit(1)

if __name__ == '__main__':
    main()
