"""AgroRisk Engine 2.0: transparent 24-hour *weather* screening rules.

These are deliberately illustrative MVP thresholds, NOT experimentally validated
crop-damage models, drought predictions or agronomic prescriptions.
Only numerical inputs available in OpenWeather 5 Day / 3 Hour Forecast are used.
Missing forecast variables produce an 'unknown' assessment, never a false zero.
"""
from __future__ import annotations

from typing import Any

LEVELS = {'high': 2, 'medium': 1, 'low': 0, 'unknown': -1}
LABELS = {'high': 'Высокий', 'medium': 'Умеренный', 'low': 'Низкий', 'unknown': 'Нет данных'}

RULES = {
    'frost': {
        'title': 'Понижение температуры',
        'rule': '≤ 0 °C — высокий; > 0 и ≤ +3 °C — умеренный; > +3 °C — низкий',
        'action': 'Сверить прогноз с условиями участка, культурой и фазой развития.',
    },
    'rain': {
        'title': 'Сильные осадки',
        'rule': '≥ 30 мм за доступные интервалы до 24 ч — высокий; ≥ 15 мм — умеренный; иначе низкий',
        'action': 'Проверить состояние почвы и водоотвод до планирования полевых работ.',
    },
    'wind': {
        'title': 'Сильный ветер',
        'rule': 'При наличии порывов: ≥ 20 м/с — высокий, ≥ 14 м/с — умеренный. Без порывов по скорости: ≥ 14 / ≥ 9 м/с.',
        'action': 'Уточнить погодную обстановку перед полевыми работами и эксплуатацией техники.',
    },
    'dry_heat': {
        'title': 'Жаркая и сухая погода',
        'rule': 'При осадках ≤ 0,3 мм: ≥ 33 °C и влажность ≤ 30% — высокий; при осадках ≤ 1 мм: ≥ 28 °C и влажность ≤ 40% — умеренный.',
        'action': 'Осмотреть растения и проверить влажность почвы датчиком или полевым обследованием.',
    },
}


def numeric(value: Any) -> float | None:
    """Accept finite JSON numerics, exclude booleans, strings and NaN/infinity."""
    import math
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def assessment(kind: str, level: str, value: float | None, unit: str,
               reason: str, source: str, coverage: str = '') -> dict:
    return {
        'id': kind,
        'title': RULES[kind]['title'],
        'level': level,
        'label': LABELS[level],
        'value': round(value, 1) if value is not None else None,
        'unit': unit,
        'reason': reason,
        'rule': RULES[kind]['rule'],
        'next_step': RULES[kind]['action'],
        'data_source': source,
        'coverage': coverage,
    }


def analyze_risks(weather: dict, forecast: dict) -> dict:
    """Assess the AVAILABLE forecast intervals inside the next 24 h.

    3-hour OpenWeather intervals aren't instantaneous sensor observations and may
    cover less than a complete 24 h from the time the request was made.
    """
    source = str(forecast.get('source', 'unknown'))
    points = forecast.get('points') or []
    if not isinstance(points, list):
        points = []
    num_points = len(points)
    coverage = f'{num_points} прогнозных интервалов по 3 часа (не непрерывные измерения)'
    results = []

    minimum = numeric(forecast.get('min_temperature_next_24h_c'))
    if minimum is None:
        results.append(assessment('frost', 'unknown', None, '°C', 'Нет температурного минимума в прогнозе.', source, coverage))
    else:
        level = 'high' if minimum <= 0 else 'medium' if minimum <= 3 else 'low'
        results.append(assessment('frost', level, minimum, '°C',
            f'Минимальная прогнозная температура {minimum:g} °C. Уровень определён по температурному правилу, не по устойчивости культуры.', source, coverage))

    # API omits the `rain` object on dry intervals: parser explicitly uses 0.0;
    # synthetic/demo points use None, and MUST NOT be treated as zero.
    rain_values = [numeric(p.get('rain_mm_3h')) for p in points if isinstance(p, dict)]
    if num_points == 0 or len(rain_values) != num_points or any(x is None for x in rain_values):
        total_rain = None
        results.append(assessment('rain', 'unknown', None, 'мм', 'Недостаточно данных об объёме осадков по интервалам.', source, coverage))
    else:
        total_rain = round(sum(rain_values), 2)
        level = 'high' if total_rain >= 30 else 'medium' if total_rain >= 15 else 'low'
        results.append(assessment('rain', level, total_rain, 'мм',
            f'Сумма прогнозного дождя по {num_points} доступным 3-часовым интервалам: {total_rain:g} мм. Вероятность осадков не суммируется.', source, coverage))

    gusts = [numeric(p.get('wind_gust_ms')) for p in points if isinstance(p, dict)]
    speeds = [numeric(p.get('wind_ms')) for p in points if isinstance(p, dict)]
    valid_gusts = [v for v in gusts if v is not None]
    valid_speeds = [v for v in speeds if v is not None]
    if valid_gusts:
        peak_wind = max(valid_gusts)
        level = 'high' if peak_wind >= 20 else 'medium' if peak_wind >= 14 else 'low'
        results.append(assessment('wind', level, peak_wind, 'м/с',
            f'Максимальный прогнозный порыв ветра {peak_wind:g} м/с (по имеющимся точкам).', source, coverage))
    elif valid_speeds:
        peak_wind = max(valid_speeds)
        level = 'high' if peak_wind >= 14 else 'medium' if peak_wind >= 9 else 'low'
        results.append(assessment('wind', level, peak_wind, 'м/с',
            f'Прогноз порывов отсутствует; оценка только по максимальной скорости ветра {peak_wind:g} м/с.', source, coverage))
    else:
        results.append(assessment('wind', 'unknown', None, 'м/с', 'Нет прогноза ветра по интервалам.', source, coverage))

    # Temperature and humidity must belong to the SAME forecast interval;
    # independent extremes at different hours would create false alarms.
    paired = [(numeric(p.get('temperature_c')), numeric(p.get('humidity_pct')))
              for p in points if isinstance(p, dict)]
    paired = [(temp, humidity) for temp, humidity in paired if temp is not None and humidity is not None]
    if not paired or total_rain is None:
        results.append(assessment('dry_heat', 'unknown', None, '°C',
            'Нужны прогнозы температуры, влажности воздуха и объёма осадков. Без данных о почве нельзя оценить засуху.', source, coverage))
    else:
        hottest_temp, humidity_at_hottest = max(paired, key=lambda record: record[0])
        level = ('high' if any(t >= 33 and h <= 30 for t, h in paired) and total_rain <= 0.3
                 else 'medium' if any(t >= 28 and h <= 40 for t, h in paired) and total_rain <= 1
                 else 'low')
        results.append(assessment('dry_heat', level, hottest_temp, '°C',
            f'Максимум {hottest_temp:g} °C, влажность в наиболее жаркий интервал {humidity_at_hottest:g}%, дождь {total_rain:g} мм. '            'Температура и сухость проверяются в одном интервале. Это погодные предпосылки, НЕ диагноз засухи.', source, coverage))

    known = [r for r in results if r['level'] != 'unknown']
    worst = max(known, key=lambda r: LEVELS[r['level']]) if known else None
    overall_level = worst['level'] if worst else 'unknown'
    warnings = [r for r in results if r['level'] in ('high', 'medium')]
    summary = ('; '.join(f"{r['title'].lower()} — {r['label'].lower()}" for r in warnings)
               if warnings else 'По имеющимся данным повышенные погодные риски не выявлены.' if known
               else 'Недостаточно данных для оценки погодных рисков.')
    return {
        'version': '2.0',
        'source': source,
        'period_hours': forecast.get('period_hours', 24),
        'overall': {'level': overall_level, 'label': LABELS[overall_level],
                    'reason': summary, 'basis': 'weather_rule_screening_24h',
                    'min_temperature_next_24h_c': minimum,
                    'rule': 'Максимальный уровень среди оценённых погодных факторов'},
        'assessments': results,
        'known_count': len(known),
        'unknown_count': len(results) - len(known),
        'disclaimer': ('Учебные пороги для метеорологического скрининга, не откалиброваны по культуре и фазе роста. '
                       'Это не диагноз заболевания, не вероятность гибели урожая и не прогноз засухи. '
                       'Модель OpenWeather не измеряет фактические условия почвы на участке.'),
        'is_simulation': source in ('demo', 'scenario'),
    }


DEMO_SCENARIOS = {
    'frost': {'title': 'Заморозок', 'subtitle': 'Снижение температуры до −4 °C'},
    'rain': {'title': 'Ливневые осадки', 'subtitle': '36 мм за 24 часа'},
    'wind': {'title': 'Сильный ветер', 'subtitle': 'Порывы до 23 м/с'},
    'dry_heat': {'title': 'Сухая жара', 'subtitle': '+35 °C, влажность 22%'},
}


def simulate_scenario(scenario: str) -> dict:
    """Pure simulation, NEVER changes actual fields, stored weather or forecasts."""
    if scenario not in DEMO_SCENARIOS:
        raise ValueError('Неизвестный сценарий')
    points = [dict(timestamp=1_800_000_000 + i * 10800, temperature_c=19.0,
                   humidity_pct=55, wind_ms=3.0, wind_gust_ms=6.0,
                   rain_mm_3h=0.0, precipitation_probability_pct=10)
              for i in range(8)]
    if scenario == 'frost':
        for i, p in enumerate(points):
            p['temperature_c'] = [4, 2, 0, -2, -4, -1, 3, 5][i]
    elif scenario == 'rain':
        for p in points:
            p.update(rain_mm_3h=4.5, precipitation_probability_pct=95, humidity_pct=90)
    elif scenario == 'wind':
        for p in points:
            p.update(wind_ms=15, wind_gust_ms=23)
    elif scenario == 'dry_heat':
        for p in points:
            p.update(temperature_c=35, humidity_pct=22, rain_mm_3h=0.0,
                     precipitation_probability_pct=0)
    forecast = {'source': 'scenario', 'points': points,
                'period_hours': 24, 'sample_count': len(points),
                'min_temperature_next_24h_c': min(p['temperature_c'] for p in points)}
    result = analyze_risks({}, forecast)
    return {'scenario': scenario, **DEMO_SCENARIOS[scenario],
            'analysis': result, 'notice': 'СИМУЛЯЦИЯ ДЛЯ ЖЮРИ. Не связано с погодой реальных полей.'}
