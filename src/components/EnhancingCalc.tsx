import { Flex, Group, Loader, NumberInput, Table, Title } from "@mantine/core";
import { ApiData } from "../services/ApiService";
import { Cost, ItemDetail } from "../models/Client";
import { MarketValue } from "../models/Market";
import { useState } from "react";
import { getFriendlyIntString } from "../helpers/Formatting";
import Icon from "./Icon";
import { Duration } from "luxon";

interface Props {
  data: ApiData;
  item: ItemDetail & MarketValue;
  baseLevel: number;
  toolPercent: number;
  gearSpeed: number;
  target: number;
  teas: string[];
}

const FAIL_XP = 0.1;
const TARGET_COL = [...Array(21).keys()];

export default function EnhancingCalc({
  data,
  item,
  baseLevel,
  toolPercent,
  gearSpeed,
  target,
  teas,
}: Props) {
  const toolBonus = toolPercent * 0.01;
  const action = data.actionDetails["/actions/enhancing/enhance"];
  const [protCostOverride, setProtCostOverride] = useState<number | "">("");
  const [gphCommission, setGphCommission] = useState<number | "">("");
  const [priceOverrides, setPriceOverrides] = useState<{
    [key: string]: number | "";
  }>({});

  const blessedTeaBonus = teas.some((x) => x === "/items/blessed_tea")
    ? 0.01
    : 0;
  const teaLevelBonus = teas.some((x) => x === "/items/super_enhancing_tea")
    ? 6
    : teas.some((x) => x === "/items/enhancing_tea")
    ? 3
    : 0;
  const wisdomTeaBonus = teas.some((x) => x === "/items/wisdom_tea") ? 1.12 : 1;

  const level = baseLevel + teaLevelBonus;

  if (!item.enhancementCosts) return <Loader />;

  const actionTimer =
    (action.baseTimeCost / 1000000000) *
    Math.min(1, 100 / (100 + level - item.itemLevel + (gearSpeed || 0)));

  const getApproxValue = (hrid: string): number => {
    if (hrid === "/items/coin") return 1;

    if (priceOverrides[hrid]) return +priceOverrides[hrid];

    const item = data.itemDetails[hrid];

    if (item.ask === -1 && item.bid === -1) {
      return item.sellPrice;
    } else if (item.ask === -1) {
      return item.bid;
    } else if (item.bid === -1) {
      return item.ask;
    } else {
      return +((item.ask + item.bid) / 2).toFixed(0);
    }
  };

  const getAveragePrice = (items: Cost[] | null): number => {
    let price = 0;

    if (!items) return price;

    price = items
      .map((y) => y.count * getApproxValue(y.itemHrid))
      .reduce((acc, val) => acc + val);

    return price;
  };

  function X(N: number) {
    return (
      data.enhancementLevelSuccessRateTable[N] *
      (Math.min((level / item.itemLevel + 1) / 2, 1) +
        toolBonus +
        0.0005 * Math.max(level - item.itemLevel, 0))
    );
  }

  function Z(N: number) {
    if (N <= 0) {
      return 1 - X(0);
    } else if (N == 1) {
      return (1 - X(N)) * X(N - 1);
    }
    const n = [...Array(N).keys()];
    return (1 - X(N)) * n.map((i) => X(i)).reduce((a, b) => a * b);
  }

  function S(N: number) {
    if (N <= 0) {
      return 1 - X(0);
    } else if (N == 1) {
      return X(N - 1);
    }
    const n = [...Array(N).keys()];
    return n.map((i) => X(i)).reduce((a, b) => a * b);
  }

  function T(N: number) {
    return N + 1;
  }
  const costPerEnhance = getAveragePrice(item.enhancementCosts);
  const extraProtItems: Cost[] =
    item.protectionItemHrids?.map((y) => ({ count: 1, itemHrid: y } as Cost)) ??
    [];
  const protectionItems: Cost[] = extraProtItems.concat([
    { count: 1, itemHrid: item.hrid },
    {
      itemHrid: "/items/mirror_of_protection",
      count: 1,
    },
  ]);

  const protectionCost =
    protCostOverride ||
    protectionItems.reduce((acc, val) => {
      const cost = getApproxValue(val.itemHrid);
      if (acc === -1 || cost < acc) return cost;
      return acc;
    }, -1);
  var protectionCostP1 = protectionCost * 2.0;
  var protectionCostM1 = protectionCost * 0.5;

  const pCol = TARGET_COL.map((x) => (x === 0 ? 0 : X(x - 1)));
  const sCol = TARGET_COL.map((x) => S(x));
  const zCol = TARGET_COL.map((x) => Z(x));
  const tCol = TARGET_COL.map((x) => T(x));
  const costCol = TARGET_COL.reduce((acc: number[], _x, i) => {
    if (i === 0) return [0];
    const previous =
      acc.reduce(
        (sum, _value, j) => sum + zCol[TARGET_COL[j]] * tCol[TARGET_COL[j]],
        0
      ) +
      sCol[i] * tCol[i - 1];

    const cost = (previous / sCol[i]) * costPerEnhance;
    acc.push(cost);
    return acc;
  }, []);

  
  function CalculateInflection(protCost: number) {
    return TARGET_COL.reduce((acc: number[], x) => {
      if (x <= 1) {
        acc.push(costCol[x]);
      } else {
        const back = acc[acc.length - 1];
        const back2 = acc[acc.length - 2];
        const newValue = Math.min(
          costCol[x],
          (back +
            (protCost * (1 - pCol[x]) + costPerEnhance) -
            (1 - pCol[x]) * back2) /
            pCol[x]
        );
        acc.push(newValue);
      }
      return acc;
    }, []);
  }

  const inflectionCol: number[] = CalculateInflection(protectionCost);
  const protLevel = costCol.findLastIndex((x, i) => x <= inflectionCol[i]);

  var inflectionColP1: number[] = CalculateInflection(protectionCostP1);
  var protLevelP1 = costCol.findLastIndex((x, i) => x <= inflectionColP1[i]);
  while(protLevelP1 < protLevel + 1)
  {
    protectionCostP1 *= 2.0;
    inflectionColP1 = CalculateInflection(protectionCostP1);
    protLevelP1 = costCol.findLastIndex((x, i) => x <= inflectionColP1[i]);
  }
  
  var inflectionColM1: number[] = CalculateInflection(protectionCostM1);
  var protLevelM1 = costCol.findLastIndex((x, i) => x <= inflectionColM1[i]);
  while(protLevelM1 > protLevel - 1 && protLevel > 2)
  {
    protectionCostM1 *= 0.5;
    inflectionColM1 = CalculateInflection(protectionCostM1);
    protLevelM1 = costCol.findLastIndex((x, i) => x <= inflectionColM1[i]);
  }

  function CalculateActions(protectionLevel: number) {
    return TARGET_COL.reduce((acc: number[], x) => {
      if (x <= protectionLevel) {
        acc.push(costCol[x] / costPerEnhance);
      } else {
        const back = acc[acc.length - 1];
        const back2 = acc[acc.length - 2];
        acc.push((back + 1 - (1 - pCol[x]) * back2) / pCol[x]);
      }
      return acc;
    }, []);
  }

  const actionsCol = CalculateActions(protLevel);
  const actionsColP1 = CalculateActions(protLevelP1);
  const actionsColM1 = CalculateActions(protLevelM1);

  const protUsedCol   = TARGET_COL.map((x) => (inflectionCol  [x] - actionsCol  [x] * costPerEnhance) / protectionCost);
  const protUsedColP1 = TARGET_COL.map((x) => (inflectionColP1[x] - actionsColP1[x] * costPerEnhance) / protectionCostP1);
  const protUsedColM1 = TARGET_COL.map((x) => (inflectionColM1[x] - actionsColM1[x] * costPerEnhance) / protectionCostM1);

  const criticalCol = TARGET_COL.reduce((acc: number[], x) => {
    if (x <= 1 || blessedTeaBonus === 0) {
      acc.push(1);
    } else {
      const back = acc[acc.length - 1];
      const teaInvert = 1 - blessedTeaBonus;
      acc.push(
        (Math.pow(teaInvert, 2) +
          blessedTeaBonus * teaInvert * (1 - pCol[x]) +
          blessedTeaBonus / pCol[x - 1]) *
          back
      );
    }
    return acc;
  }, []);

  const expectedCostCol   = TARGET_COL.map((x) => inflectionCol  [x] / criticalCol[x]);
  const expectedCostColP1 = TARGET_COL.map((x) => inflectionColP1[x] / criticalCol[x] - protectionCost * protUsedColP1[x]);
  const expectedCostColM1 = TARGET_COL.map((x) => inflectionColM1[x] / criticalCol[x] + protectionCost * 0.5 * protUsedColM1[x]);

  const cost = expectedCostCol[target];
  const costP1 = expectedCostColP1[target];
  const costM1 = expectedCostColM1[target];

  const gphCommissionNumber: number = gphCommission;
  const commissionCost   = expectedCostCol  [target] + gphCommissionNumber / 3600 * actionsCol  [target] * actionTimer;
  const commissionCostP1 = expectedCostColP1[target] + gphCommissionNumber / 3600 * actionsColP1[target] * actionTimer;
  const commissionCostM1 = expectedCostColM1[target] + gphCommissionNumber / 3600 * actionsColM1[target] * actionTimer;

  const sample = [
    ...Array(data.enhancementLevelSuccessRateTable.length).keys(),
  ];

  const getAverageEnhanceXp = () => {
    return (
      (sample
        .map((i) => S(i) * i + Z(i) * (i + 1) * FAIL_XP)
        .reduce((a, b) => a + b) /
        sample.map((i) => Z(i) * T(i)).reduce((a, b) => a + b)) *
      1.5 *
      (item.itemLevel + 10) *
      wisdomTeaBonus
    );
  };

  const averageEnhanceXp = getAverageEnhanceXp();

  const protectionItemRows = protectionItems.map((x) => {
    const marketItem = data.itemDetails[x.itemHrid];
    return (
      <tr>
        <td>
          <Flex
            justify="flex-start"
            align="center"
            direction="row"
            wrap="wrap"
            gap="xs"
          >
            <Icon hrid={x.itemHrid} /> {marketItem.name}
          </Flex>
        </td>
        <td>{getFriendlyIntString(marketItem.ask)}</td>
        <td>{getFriendlyIntString(marketItem.bid)}</td>
        <td>{getFriendlyIntString(marketItem.sellPrice)}</td>
      </tr>
    );
  });

  const marketRows = item.enhancementCosts.map((x) => {
    if (x.itemHrid === "/items/coin") {
      return (
        <tr key={"override/enhancing/" + x.itemHrid}>
          <td>
            <Flex
              justify="flex-start"
              align="center"
              direction="row"
              wrap="wrap"
              gap="xs"
            >
              <Icon hrid={x.itemHrid} /> Coin
            </Flex>
          </td>
          <td>{x.count}</td>
          <td colSpan={3} />
          <td>1</td>
          <td>{getFriendlyIntString(actionsCol[target] * x.count)}</td>
        </tr>
      );
    }

    const marketItem = data.itemDetails[x.itemHrid];
    return (
      <tr key={"override/enhancing/" + x.itemHrid}>
        <td>
          <Flex
            justify="flex-start"
            align="center"
            direction="row"
            wrap="wrap"
            gap="xs"
          >
            <Icon hrid={x.itemHrid} /> {marketItem.name}
          </Flex>
        </td>
        <td>{x.count}</td>
        <td>{getFriendlyIntString(marketItem.ask)}</td>
        <td>{getFriendlyIntString(marketItem.bid)}</td>
        <td>{getFriendlyIntString(marketItem.sellPrice)}</td>
        <td>
          <NumberInput
            hideControls
            placeholder={getFriendlyIntString(getApproxValue(x.itemHrid))}
            disabled={x.itemHrid === "/items/coin"}
            value={priceOverrides[x.itemHrid]}
            onChange={(y) =>
              setPriceOverrides({
                ...priceOverrides,
                [x.itemHrid]: y,
              })
            }
          />
        </td>
        <td>{getFriendlyIntString(actionsCol[target] * x.count)}</td>
      </tr>
    );
  });

  return (
    <Flex
      gap="sm"
      justify="flex-start"
      align="flex-start"
      direction="column"
      wrap="wrap"
    >
      <Group>
        <NumberInput
          label="Protection Cost"
          hideControls
          placeholder={getFriendlyIntString(protectionCost)}
          min={1}
          value={protCostOverride}
          onChange={setProtCostOverride}
        />
        <NumberInput
          label="Gold/Hour Commission"
          hideControls
          placeholder={getFriendlyIntString(0)}
          min={0}
          value={gphCommission}
          onChange={setGphCommission}
        />
      </Group>
      <Flex gap="lg">
        <Flex direction="column">
          <Title order={4}>Enhancement Costs</Title>
          <Table striped highlightOnHover withBorder withColumnBorders>
            <thead>
              <tr>
                <th>Item</th>
                <th>Count</th>
                <th>Ask</th>
                <th>Bid</th>
                <th>Vendor</th>
                <th>Value</th>
                <th>Average Used</th>
              </tr>
            </thead>
            <tbody>
              {marketRows}
              <tr>
                <th colSpan={5}>Total</th>
                <td>{getFriendlyIntString(costPerEnhance)}</td>
                <td></td>
              </tr>
            </tbody>
          </Table>
        </Flex>
        <Flex direction="column">
          <Title order={4}>Protection Items</Title>
          <Table striped highlightOnHover withBorder withColumnBorders>
            <thead>
              <tr>
                <th>Item</th>
                <th>Ask</th>
                <th>Bid</th>
                <th>Vendor</th>
              </tr>
            </thead>
            <tbody>{protectionItemRows}</tbody>
          </Table>
        </Flex>
      </Flex>

      <Flex direction="column">
        <Table highlightOnHover withBorder>
          <tbody>
            <tr>
              <th>time/action</th>
              <td>{Duration.fromObject({ seconds: actionTimer }).toHuman()}</td>
            </tr>
            <tr>
              <th>avg xp/action</th>
              <td>{averageEnhanceXp.toFixed(2)}</td>
            </tr>
            <tr>
              <th>Average Total xp</th>
              <td>
                {getFriendlyIntString(actionsCol[target] * averageEnhanceXp)}
              </td>
            </tr>
            <tr>
              <th>coin/xp</th>
              <td>
                {getFriendlyIntString(costPerEnhance / averageEnhanceXp, 2)}
              </td>
            </tr>
            <tr>
              <th>xp/hr</th>
              <td>
                {getFriendlyIntString((averageEnhanceXp * 3600) / actionTimer)}
              </td>
            </tr>
            <tr>
              <th>Prot Level</th>
              <td>{protLevelM1}</td>
              <td>{protLevel}</td>
              <td>{protLevelP1}</td>
            </tr>
            <tr>
              <th>Prots Used</th>
              <td>{protUsedColM1[target].toFixed(2)}</td>
              <td>{protUsedCol[target].toFixed(2)}</td>
              <td>{protUsedColP1[target].toFixed(2)}</td>
            </tr>
            <tr>
              <th>Average Actions</th>
              <td>{getFriendlyIntString(actionsColM1[target], 2)}</td>
              <td>{getFriendlyIntString(actionsCol[target], 2)}</td>
              <td>{getFriendlyIntString(actionsColP1[target], 2)}</td>
            </tr>
            <tr>
              <th>Average Time</th>
              <td>
                {Duration.fromObject({
                  seconds: actionsColM1[target] * actionTimer,
                })
                  .shiftTo("hours", "minutes", "seconds")
                  .toHuman()}
              </td>
              <td>
                {Duration.fromObject({
                  seconds: actionsCol[target] * actionTimer,
                })
                  .shiftTo("hours", "minutes", "seconds")
                  .toHuman()}
              </td>
              <td>
                {Duration.fromObject({
                  seconds: actionsColP1[target] * actionTimer,
                })
                  .shiftTo("hours", "minutes", "seconds")
                  .toHuman()}
              </td>
            </tr>
            <tr>
              <th>Average Cost</th>
              <td>{getFriendlyIntString(costM1)}</td>
              <td>{getFriendlyIntString(cost)}</td>
              <td>{getFriendlyIntString(costP1)}</td>
            </tr>
            <tr>
              <th>Commissioned Cost</th>
              <td>{getFriendlyIntString(commissionCostM1)}</td>
              <td>{getFriendlyIntString(commissionCost)}</td>
              <td>{getFriendlyIntString(commissionCostP1)}</td>
            </tr>
          </tbody>
        </Table>
      </Flex>
      <Table>
        <thead>
          <tr>
            <th>Target</th>
            <th>Mod Probability</th>
            <th>S(N)</th>
            <th>Z(N)</th>
            <th>T(N)</th>
            <th>Cost Target</th>
            <th>Inflection</th>
            <th>Actions</th>
            <th>Protections</th>
            <th>Critical</th>
            <th>Average Cost</th>
            <th></th>
            <th>Inflection +1</th>
            <th>Actions +1</th>
            <th>Protections +1</th>
            <th>Cost +1</th>
            <th></th>
            <th>Inflection -1</th>
            <th>Actions -1</th>
            <th>Protections -1</th>
            <th>Cost -1</th>
          </tr>
        </thead>
        <tbody>
          {TARGET_COL.map((x) => {
            return (
              <tr key={"enhancing/results/" + x}>
                <td>{x}</td>
                <td>{pCol[x].toFixed(5)}</td>
                <td>{sCol[x].toFixed(10)}</td>
                <td>{zCol[x].toFixed(10)}</td>
                <td>{tCol[x]}</td>
                <td>{getFriendlyIntString(costCol[x])}</td>
                <td>{getFriendlyIntString(inflectionCol[x])}</td>
                <td>{getFriendlyIntString(actionsCol[x], 2)}</td>
                <td>{getFriendlyIntString(protUsedCol[x], 2)}</td>
                <td>{criticalCol[x].toFixed(4)}</td>
                <td>{getFriendlyIntString(expectedCostCol[x])}</td>
                <td>{"_____"}</td>
                <td>{getFriendlyIntString(inflectionColP1[x])}</td>
                <td>{getFriendlyIntString(actionsColP1[x], 2)}</td>
                <td>{getFriendlyIntString(protUsedColP1[x], 2)}</td>
                <td>{getFriendlyIntString(expectedCostColP1[x])}</td>
                <td>{"_____"}</td>
                <td>{getFriendlyIntString(inflectionColM1[x])}</td>
                <td>{getFriendlyIntString(actionsColM1[x], 2)}</td>
                <td>{getFriendlyIntString(protUsedColM1[x], 2)}</td>
                <td>{getFriendlyIntString(expectedCostColM1[x])}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Flex>
  );
}
