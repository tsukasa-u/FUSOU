import os
import sys
import re
from typing import Set

def get_words(line: str) -> Set[str]:
    """
    行から単語のセットを取得します。
    英数字（とアンダースコア）を単語とみなし、小文字に統一します。
    """
    # \W+ は英数字とアンダースコア(_)以外の文字（句読点、スペース、日本語など）
    # を区切り文字として扱います。
    return set(filter(None, re.split(r'\W+', line.lower())))

def process_file(file_path: str):
    """
    単一のファイルを処理し、条件に合う上の行を削除して上書き保存します。
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        if len(lines) < 2:
            return

        indices_to_delete = set()
        
        for i in range(len(lines) - 1):
            line_A = lines[i] # 上の行
            line_B = lines[i+1] # 下の行
            
            # --- ここからが変更点 ---
            
            # 1. まず、上の行(line_A)が安全チェックの条件を満たすか確認
            #    "#[serde(rename" という文字列がそのまま含まれているか
            if "#[serde(rename" not in line_A:
                continue # 条件を満たさなければ、次の行のペアへ

            # 2. 条件を満たした場合のみ、共通単語のチェックを実行
            words_A = get_words(line_A)
            words_B = get_words(line_B)
            
            # 共通の単語があるか確認
            if words_A and words_B and words_A.intersection(words_B):
                indices_to_delete.add(i) # 上の行(i)を削除対象に
            
            # --- 変更点ここまで ---

        if not indices_to_delete:
            return

        # 削除対象を除いた新しい行リストを作成します
        new_lines = []
        for i, line in enumerate(lines):
            if i not in indices_to_delete:
                new_lines.append(line)

        # ファイルに書き戻します
        with open(file_path, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)
            
        print(f"Processed (updated): {file_path}")

    except UnicodeDecodeError:
        print(f"Skipped (not utf-8): {file_path}")
    except IOError as e:
        print(f"Skipped (IOError: {e}): {file_path}")
    except Exception as e:
        print(f"Skipped (Error: {e}): {file_path}")


def main(target_directory: str):
    """
    指定されたディレクトリ以下のすべてのファイルを再帰的に処理します。
    """
    if not os.path.isdir(target_directory):
        print(f"Error: '{target_directory}' は有効なディレクトリではありません。", file=sys.stderr)
        return

    print(f"Starting processing in: {target_directory}")
    
    for root, dirs, files in os.walk(target_directory):
        for filename in files:
            file_path = os.path.join(root, filename)
            process_file(file_path)

    print("Processing finished.")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: python {sys.argv[0]} <target_directory>")
        print("注意: このスクリプトはファイルを直接上書きします。必ずバックアップを取得してください。")
        sys.exit(1)
        
    directory_to_process = sys.argv[1]
    main(directory_to_process)