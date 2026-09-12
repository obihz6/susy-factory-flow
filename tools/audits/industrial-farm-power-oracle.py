"""Validate farm thresholds against the pinned, unmodified GregTech calculator.

Requires Git, Python 3, and JDK 17+. No downloads or repository edits.
Example:
  py tools/audits/industrial-farm-power-oracle.py --gregtech .industrial-farm-audit/GT5-Unofficial

The checkout must contain revision 6e32345058a2f5b97b1d7b92db268cd2e3ebab82.
Generated upstream Java remains under the requested output directory.
"""
import argparse
import csv
import io
import json
from pathlib import Path
import subprocess

REVISION = "6e32345058a2f5b97b1d7b92db268cd2e3ebab82"


def run(*args):
    return subprocess.check_output(args, text=True, encoding="utf-8")


def extract_method(source, signature):
    start = source.index(signature)
    end = source.index("{", start) + 1
    depth = 1
    while depth:
        if source[end] == "{":
            depth += 1
        elif source[end] == "}":
            depth -= 1
        end += 1
    return source[start:end]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gregtech", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path(".industrial-farm-audit/repro"))
    args = parser.parse_args()
    root = args.output.resolve()

    def upstream(filename):
        return run("git", "-C", str(args.gregtech), "show",
                   f"{REVISION}:src/main/java/gregtech/api/util/{filename}.java")

    files = []

    def write(name, text):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        files.append(str(path))

    write("gregtech/api/util/OverclockCalculator.java", upstream("OverclockCalculator"))
    utility = upstream("GTUtility")
    signatures = [
        "public static long log4(long a)",
        "public static long log4ceil(long a)",
        "public static int clamp(int val, int lo, int hi)",
        "public static double powInt(double base, int exp)",
        "private static double powBySquaring(double base, int exp)",
    ]
    methods = "\n".join(extract_method(utility, signature) for signature in signatures)
    write("gregtech/api/util/GTUtility.java",
          "package gregtech.api.util; public class GTUtility {\n" + methods + "\n}")
    write("javax/annotation/Nonnull.java", "package javax.annotation; public @interface Nonnull {}")
    write("gregtech/api/util/GTRecipe.java",
          "package gregtech.api.util; public class GTRecipe { public int mEUt; public int mDuration; }")
    write("FarmPowerOracle.java", JAVA_HARNESS)
    subprocess.run(["javac", "-d", str(root / "classes"), *files], check=True)
    output = run("java", "-cp", str(root / "classes"), "FarmPowerOracle")
    (root / "results.csv").write_text(output, encoding="utf-8")
    rows = list(csv.DictReader(io.StringIO(output)))
    mismatches = []
    for row in rows:
        base, supply, actual_oc, actual_draw = (
            int(row[key]) for key in ("baseEuT", "supplyEuT", "overclocks", "drawEuT")
        )
        expected_oc = 0
        while base * 4 ** (expected_oc + 1) <= supply:
            expected_oc += 1
        if expected_oc != actual_oc or base * 4 ** expected_oc != actual_draw:
            mismatches.append(row)
    summary = {"gregtechRevision": REVISION, "cases": len(rows), "mismatches": len(mismatches)}
    (root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary))
    if len(rows) != 3780 or mismatches:
        raise SystemExit("Calculator comparison failed")


JAVA_HARNESS = """import gregtech.api.util.OverclockCalculator;
public class FarmPowerOracle {
 public static void main(String[] args) {
  System.out.println("baseEuT,supplyEuT,overclocks,drawEuT");
  for(int tier=2;tier<=13;tier++) {
   long base=(8L << (2*tier))*30/32;
   for(double factor:new double[]{1,1.5,2,2.25,3.5,4.5,6}) {
    long power=(long)(base*factor);
    for(int oc=0;oc<=8;oc++) {
     long threshold=power*(1L<<(2*oc));
     for(long supply:new long[]{0,power-1,threshold-1,threshold,threshold+1}) {
      OverclockCalculator c=new OverclockCalculator().setRecipeEUt(power).setEUt(supply)
        .setDuration(Integer.MAX_VALUE).calculate();
      System.out.println(power+","+supply+","+c.getPerformedOverclocks()+","+c.getConsumption());
     }
    }
   }
  }
 }
}
"""

if __name__ == "__main__":
    main()
