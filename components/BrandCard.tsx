import Link from 'next/link';
import {brands,type Brand} from '@/lib/config';
export default function BrandCard({brand,index}:{brand:Brand;index:number}){const b=brands[brand];return <Link className={`world-card world-${b.color}`} href={`/${brand}/`}><div className="world-top"><span className="world-number">0{index+1}</span><span className="world-icon" aria-hidden="true">{b.icon}</span></div><h3>{b.name}</h3><p>{b.short}</p><span className="world-link">Step inside <span aria-hidden="true">↗</span></span></Link>}
