import 'package:flutter/material.dart';

import '../../../../core/models/top_list.dart';
import '../../../../shared/widgets/tune_free_card.dart';

class TopListCarousel extends StatelessWidget {
  const TopListCarousel({super.key, required this.topLists, required this.onTap});

  final List<TopList> topLists;
  final ValueChanged<TopList> onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 156,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: topLists.length,
        separatorBuilder: (context, index) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final list = topLists[index];
          return GestureDetector(
            onTap: () => onTap(list),
            child: SizedBox(
              width: 136,
              child: TuneFreeCard(
                padding: const EdgeInsets.all(8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(16),
                        child: Container(color: const Color(0xFFF0F1F5)),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      list.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                    ),
                    Text(
                      list.updateFrequency ?? '每日更新',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 10, color: Color(0xFF8B8B95)),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
