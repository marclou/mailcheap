import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Status, Signed up, Source and Tag.
const FILTER_WIDTHS = ["w-20", "w-26", "w-22", "w-16"];
const EMAIL_WIDTHS = [62, 48, 70, 54, 44, 66, 58, 50, 72, 46];

// The contacts lists while they load: the search and the filters (FilterContacts), then a page (TableContacts).
export default function SkeletonContacts() {
	return (
		<div aria-hidden="true" className="flex flex-col gap-4">
			<div className="flex flex-col gap-2 md:flex-row md:items-center">
				<Skeleton className="h-9 w-full rounded-lg md:w-56" />
				<div className="flex gap-1.5 overflow-hidden">
					{FILTER_WIDTHS.map((width, index) => (
						<Skeleton key={index} className={cn("h-8 shrink-0 rounded-full", width)} />
					))}
				</div>
			</div>
			<div className="overflow-hidden rounded-xl shadow-border">
				<Table>
					<TableHeader>
						<TableRow className="hover:bg-transparent">
							<TableHead className="w-10 pr-0 pl-4">
								<Skeleton className="size-4 rounded-[4px]" />
							</TableHead>
							<TableHead className="pl-3">Email</TableHead>
							<TableHead className="hidden md:table-cell">Tags</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="hidden text-right lg:table-cell">Opens</TableHead>
							<TableHead className="hidden text-right lg:table-cell">Clicks</TableHead>
							<TableHead className="hidden text-right sm:table-cell">Added</TableHead>
							<TableHead className="w-12 pr-2" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{EMAIL_WIDTHS.map((width, index) => (
							<TableRow key={index} className="hover:bg-transparent">
								<TableCell className="w-10 py-2.5 pr-0 pl-4">
									<Skeleton className="size-4 rounded-[4px]" />
								</TableCell>
								<TableCell className="w-full max-w-0 py-2.5 pl-3 sm:w-2/5">
									<span className="flex items-center gap-2.5">
										<Skeleton className="size-[26px] shrink-0 rounded-full" />
										<Skeleton className="h-3.5" style={{ width: `${width}%` }} />
									</span>
								</TableCell>
								<TableCell className="hidden md:table-cell">
									<Skeleton className="h-5 w-12 rounded-md" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-6 w-16 rounded-full" />
								</TableCell>
								<TableCell className="hidden lg:table-cell">
									<Skeleton className="ml-auto h-3 w-8" />
								</TableCell>
								<TableCell className="hidden lg:table-cell">
									<Skeleton className="ml-auto h-3 w-6" />
								</TableCell>
								<TableCell className="hidden sm:table-cell">
									<Skeleton className="ml-auto h-3 w-20" />
								</TableCell>
								<TableCell className="pr-2">
									<span className="block size-7" />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
